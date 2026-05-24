/**
 * Remote Access Server — HTTP + WebSocket server for phone/remote control.
 *
 * Embeds a lightweight HTTP server inside the sidecar process that exposes
 * the same JSON protocol over HTTP/WebSocket. Connected clients (phone
 * browsers, companion apps, etc.) can send commands and receive streaming
 * events just like the Tauri desktop frontend.
 *
 * Architecture:
 * ```
 * Phone Browser ─── POST /api/command ──► command queue ──► sidecar dispatch
 *                 ◄── SSE  /api/events ◄── EventBus (from send())
 *                 ◄── WS   /ws        ◄── EventBus (from send())
 * ```
 *
 * Security:
 * - Default: binds to 127.0.0.1 (local machine only)
 * - LAN access: user must explicitly enable via Settings
 * - PIN pairing: first-time auth via single-use PIN shown in desktop UI
 *
 * @module remote-server
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { eventBus, type BusEvent } from "./event-bus.js";
import { commandQueue } from "./command-queue.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RemoteServerConfig {
	port: number;
	host: string;
}

interface RemoteServerState {
	server: http.Server;
	wss: WebSocketServer;
	config: RemoteServerConfig;
	pin: string;
	pinExpiresAt: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state: RemoteServerState | null = null;

/** Generate a random 6-digit PIN */
function generatePin(): string {
	return String(randomBytes(3).readUInt16BE(0) % 1000000).padStart(6, "0");
}

// ---------------------------------------------------------------------------
// CORS and common headers
// ---------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization, X-Remote-Pin",
};

function writeJson(res: http.ServerResponse, status: number, data: unknown): void {
	res.writeHead(status, {
		"Content-Type": "application/json",
		...CORS_HEADERS,
	});
	res.end(JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// Request router
// ---------------------------------------------------------------------------

async function handleRequest(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	zosmaDir: string,
): Promise<void> {
	const url = req.url || "/";
	const method = req.method || "GET";

	// CORS preflight
	if (method === "OPTIONS") {
		res.writeHead(204, CORS_HEADERS);
		res.end();
		return;
	}

	// Static file serving (mobile web UI)
	if (method === "GET" && !url.startsWith("/api/")) {
		serveStatic(req, res);
		return;
	}

	// ── POST /api/command ──────────────────────────────────────────────
	if (method === "POST" && url === "/api/command") {
		if (!verifyRequestAuth(req)) {
			writeJson(res, 401, { type: "error", id: "auth", message: "Invalid or missing PIN" });
			return;
		}
		await handleApiCommand(req, res);
		return;
	}

	// ── GET /api/events (SSE — Server-Sent Events) ─────────────────────
	if (method === "GET" && url === "/api/events") {
		if (!verifyRequestAuth(req)) {
			writeJson(res, 401, { type: "error", id: "auth", message: "Invalid or missing PIN" });
			return;
		}
		handleSSE(req, res);
		return;
	}

	// ── GET /api/status ────────────────────────────────────────────────
	if (method === "GET" && url === "/api/status") {
		writeJson(res, 200, {
			running: true,
			port: state?.config.port,
			host: state?.config.host,
			connectedClients: state?.wss.clients.size || 0,
			needsPin: !isLocalRequest(req),
		});
		return;
	}

	// ── POST /api/verify-pin ──────────────────────────────────────────
	if (method === "POST" && url === "/api/verify-pin") {
		await handlePinVerification(req, res);
		return;
	}

	// ── 404 ────────────────────────────────────────────────────────────
	writeJson(res, 404, { error: "Not found" });
}

// ---------------------------------------------------------------------------
// PIN authentication
// ---------------------------------------------------------------------------

function isLocalRequest(req: http.IncomingMessage): boolean {
	const addr = req.socket.remoteAddress;
	if (addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1") {
		return true;
	}
	return false;
}

function verifyRequestAuth(req: http.IncomingMessage): boolean {
	// Local requests are always trusted
	if (isLocalRequest(req)) return true;

	// If no PIN set (shouldn't happen), fail closed
	if (!state?.pin) return false;

	// Check PIN from header or query param
	const pinHeader = req.headers["x-remote-pin"] as string | undefined;
	const reqUrl = req.url || "/";
	const queryIndex = reqUrl.indexOf("?");
	const pinQuery = queryIndex >= 0
		? new URLSearchParams(reqUrl.slice(queryIndex)).get("pin")
		: null;

	const pin = pinHeader || pinQuery || "";
	if (pin === state.pin && Date.now() < state.pinExpiresAt) {
		return true;
	}

	return false;
}

async function handlePinVerification(
	req: http.IncomingMessage,
	res: http.ServerResponse,
): Promise<void> {
	const body = await readBody(req);
	let parsed: { pin?: string };
	try {
		parsed = JSON.parse(body);
	} catch {
		writeJson(res, 400, { success: false, message: "Invalid JSON" });
		return;
	}

	if (!state) {
		writeJson(res, 503, { success: false, message: "Remote server not running" });
		return;
	}

	if (parsed.pin === state.pin && Date.now() < state.pinExpiresAt) {
		// Generate a session token for this connection
		const token = randomBytes(16).toString("hex");
		writeJson(res, 200, { success: true, token });
		// Generate a new PIN for next pairing
		state.pin = generatePin();
		state.pinExpiresAt = Date.now() + 120_000; // 2 minutes
	} else {
		writeJson(res, 401, { success: false, message: "Invalid or expired PIN" });
	}
}

// ---------------------------------------------------------------------------
// API command handler (enqueues commands for the sidecar's main loop)
// ---------------------------------------------------------------------------

async function handleApiCommand(
	req: http.IncomingMessage,
	res: http.ServerResponse,
): Promise<void> {
	const body = await readBody(req);

	let command: Record<string, unknown>;
	try {
		command = JSON.parse(body);
	} catch {
		writeJson(res, 400, { type: "error", id: "parse", message: "Invalid JSON" });
		return;
	}

	const commandId = (command.id as string) || `http-${randomBytes(4).toString("hex")}`;
	command.id = commandId;

	log("[remote] POST /api/command: %s (id=%s)", command.type, commandId);

	// Enqueue the command for the main loop to process
	const queued = commandQueue.enqueue(command as Record<string, unknown>);

	if (!queued) {
		writeJson(res, 503, { type: "error", id: commandId, message: "Command queue full" });
		return;
	}

	// For synchronous commands, we could wait for the result on the event bus.
	// For Phase 6.0, we acknowledge the command and let the client use
	// WebSocket/SSE for streaming results.
	writeJson(res, 202, {
		type: "accepted",
		id: commandId,
		message: "Command queued. Use WebSocket or SSE for streaming response.",
	});
}

// ---------------------------------------------------------------------------
// SSE endpoint (Server-Sent Events)
// ---------------------------------------------------------------------------

function handleSSE(req: http.IncomingMessage, res: http.ServerResponse): void {
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		"Connection": "keep-alive",
		...CORS_HEADERS,
	});

	// Send initial connection event
	res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

	// Subscribe to event bus
	const unsubscribe = eventBus.subscribe((event: BusEvent) => {
		try {
			res.write(`data: ${JSON.stringify(event)}\n\n`);
		} catch {
			// Client disconnected
			unsubscribe();
		}
	});

	// Clean up on client disconnect
	req.on("close", () => {
		unsubscribe();
	});
}

// ---------------------------------------------------------------------------
// Static file serving (for mobile web UI)
// ---------------------------------------------------------------------------

/** Get the directory where the built frontend assets are served from */
function getWebDistDir(): string {
	// In the sidecar process, the agent-sidecar dir is two levels up from src/
	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	const sidecarRoot = path.resolve(__dirname, "..");
	// The web dist is at the project root: zosma-cowork/dist/
	// From agent-sidecar/src/ -> ../../dist
	const projectRoot = path.resolve(sidecarRoot, "..");
	return path.join(projectRoot, "dist");
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
	const url = req.url || "/";
	let filePath = url === "/" ? "/index.html" : url;

	// Security: prevent directory traversal
	if (filePath.includes("..")) {
		writeJson(res, 403, { error: "Forbidden" });
		return;
	}

	// Try to serve from the dist directory (compiled React frontend)
	const distDir = getWebDistDir();
	const fullPath = path.join(distDir, filePath);

	try {
		if (!fs.existsSync(fullPath)) {
			// Fall back to index.html for SPA routing
			const indexPath = path.join(distDir, "index.html");
			if (fs.existsSync(indexPath)) {
				const content = fs.readFileSync(indexPath);
				const ext = "html";
				res.writeHead(200, {
					"Content-Type": getMimeType(ext),
					...CORS_HEADERS,
				});
				res.end(content);
			} else {
				writeJson(res, 404, {
					error: "Web UI not built. Run 'npm run build:frontend' first.",
				});
			}
			return;
		}

		const ext = filePath.split(".").pop() || "bin";
		const content = fs.readFileSync(fullPath);
		res.writeHead(200, {
			"Content-Type": getMimeType(ext),
			...CORS_HEADERS,
		});
		res.end(content);
	} catch {
		writeJson(res, 500, { error: "Internal error serving static file" });
	}
}

// ---------------------------------------------------------------------------
// MIME type map
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
	html: "text/html",
	css: "text/css",
	js: "application/javascript",
	mjs: "application/javascript",
	json: "application/json",
	png: "image/png",
	svg: "image/svg+xml",
	ico: "image/x-icon",
	woff2: "font/woff2",
	ttf: "font/ttf",
};

function getMimeType(ext: string): string {
	return MIME_TYPES[ext] || "application/octet-stream";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readBody(req: http.IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
		req.on("error", () => resolve(""));
	});
}

function log(...args: unknown[]): void {
	process.stderr.write(`[remote-server] ${args.join(" ")}\n`);
}

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------

function setupWebSocket(wss: WebSocketServer): void {
	wss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
		// Verify PIN for non-local connections
		if (!isLocalRequest(req)) {
			const reqUrl = req.url || "/";
			const queryIndex = reqUrl.indexOf("?");
			const pin = queryIndex >= 0
				? new URLSearchParams(reqUrl.slice(queryIndex)).get("pin") || ""
				: "";
			if (pin !== state?.pin || Date.now() >= (state?.pinExpiresAt || 0)) {
				ws.close(4001, "Invalid or expired PIN");
				return;
			}
		}

		log("WebSocket client connected");

		// Send initial connection event
		ws.send(JSON.stringify({ type: "connected" }));

		// Subscribe to event bus
		const unsubscribe = eventBus.subscribe((event: BusEvent) => {
			if (ws.readyState === WebSocket.OPEN) {
				try {
					ws.send(JSON.stringify(event));
				} catch {
					unsubscribe();
				}
			}
		});

		// Receive commands from client — enqueue for main loop
		ws.on("message", (data: Buffer) => {
			try {
				const msg = JSON.parse(data.toString());
				log("WebSocket command: %s (id=%s)", msg.type, msg.id || "-");

				// Enqueue the command for the main loop
				const queued = commandQueue.enqueue(msg);
				if (!queued) {
					ws.send(JSON.stringify({
						type: "error",
						id: msg.id || "unknown",
						message: "Command queue full",
					}));
				}
			} catch {
				log("Invalid WebSocket message");
				ws.send(JSON.stringify({
					type: "error",
					id: "parse",
					message: "Invalid JSON",
				}));
			}
		});

		ws.on("close", () => {
			unsubscribe();
			log("WebSocket client disconnected");
		});

		ws.on("error", (err: Error) => {
			log("WebSocket error: %s", err.message);
			unsubscribe();
		});
	});
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the remote access HTTP/WS server.
 *
 * @param zosmaDir - Path to the zosma config directory
 * @param config - Server configuration (port, host)
 */
export function startRemoteServer(
	zosmaDir: string,
	config: RemoteServerConfig = { port: 8765, host: "127.0.0.1" },
): void {
	if (state) {
		log("Remote server already running on %s:%d", state.config.host, state.config.port);
		return;
	}

	const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
		handleRequest(req, res, zosmaDir).catch((err: Error) => {
			log("Request error: %s", err.message);
			if (!res.headersSent) {
				writeJson(res, 500, { error: "Internal server error" });
			}
		});
	});

	const wss = new WebSocketServer({ server, path: "/ws" });
	setupWebSocket(wss);

	// Generate initial PIN
	const pin = generatePin();
	const pinExpiresAt = Date.now() + 120_000; // 2 minutes

	server.listen(config.port, config.host, () => {
		state = { server, wss, config, pin, pinExpiresAt };
		log("Remote server listening on %s:%d (PIN: %s)", config.host, config.port, pin);

		// Emit remote server ready event via event bus (goes to Tauri + WebSocket clients)
		eventBus.publish({
			type: "event",
			data: {
				type: "event",
				event: {
					kind: "remote_server_ready",
					port: config.port,
					host: config.host,
					pin,
				},
			},
		});
	});

	server.on("error", (err: Error) => {
		log("Remote server error: %s", err.message);
		state = null;
	});
}

/**
 * Stop the remote access server.
 */
export function stopRemoteServer(): void {
	if (!state) {
		log("Remote server not running");
		return;
	}

	log("Stopping remote server on %s:%d", state.config.host, state.config.port);

	// Close all WebSocket connections
	for (const client of state.wss.clients) {
		client.close(1001, "Server shutting down");
	}

	state.wss.close();
	state.server.close();

	state = null;

	eventBus.publish({
		type: "event",
		data: {
			type: "event",
			event: { kind: "remote_server_stopped" },
		},
	});
}

/**
 * Get all non-internal IPv4 addresses of this machine.
 */
function getLocalIPs(): string[] {
	const interfaces = os.networkInterfaces();
	const ips: string[] = [];
	for (const addrs of Object.values(interfaces)) {
		if (!addrs) continue;
		for (const addr of addrs) {
			if (addr.family === "IPv4" && !addr.internal) {
				ips.push(addr.address);
			}
		}
	}
	return ips;
}

/**
 * Get the current remote server status.
 */
export function getRemoteStatus(): {
	running: boolean;
	port?: number;
	host?: string;
	connectedClients?: number;
	pin?: string;
	localIPs?: string[];
} {
	if (!state) {
		return { running: false };
	}
	return {
		running: true,
		port: state.config.port,
		host: state.config.host,
		connectedClients: state.wss.clients.size,
		pin: state.pin,
		localIPs: getLocalIPs(),
	};
}
