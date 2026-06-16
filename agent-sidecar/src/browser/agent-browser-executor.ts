/**
 * agent-browser Executor
 *
 * Typed wrapper around the `agent-browser` CLI (vercel-labs/agent-browser),
 * a native Rust browser-automation tool designed for AI agents. Each method
 * maps to one CLI subcommand invoked with `--json` for machine-readable output.
 *
 * ARCHITECTURE NOTE
 * -----------------
 * agent-browser uses a client-daemon model: the first command auto-starts a
 * Rust daemon that holds the live browser session, and subsequent CLI
 * invocations attach to it. That means each tool call here is a fresh, stateless
 * `execFileSync` spawn, yet `open` -> `snapshot` -> `click` share one browser.
 * We set AGENT_BROWSER_IDLE_TIMEOUT_MS so the daemon self-closes if the agent
 * forgets to call `browser_close`, preventing orphan Chromium processes.
 *
 * Chrome is auto-detected (existing Chrome/Brave/Chromium/Playwright installs),
 * so no separate `agent-browser install` step is required when a browser exists.
 *
 * PHASE 0 SCOPE: headless only, ephemeral default profile, no persisted auth.
 *
 * PRODUCTION BUNDLING TODO (tracked in docs/plans/2026-06-16-browser-harness-plan.md):
 * the Tauri bundle ships only `index.cjs` + node binaries as resources, NOT
 * node_modules. The agent-browser native binary must therefore be added to the
 * Tauri `resources`/`externalBin` set (per-platform) for packaged builds. Until
 * then, resolution falls back to a PATH / `npx` install for dev + global users.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Constants ───────────────────────────────────────────────────────

/** Per-command hard timeout. Navigation can be slow on cold pages. */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Idle timeout for the background daemon. If no command arrives within this
 * window the daemon closes the browser and exits — our safety net against
 * orphaned Chromium when the agent never calls browser_close.
 */
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

// ─── Result shape ────────────────────────────────────────────────────

/** agent-browser's `--json` envelope: `{ success, data, error }`. */
export interface AgentBrowserResult<T = unknown> {
	success: boolean;
	data: T | null;
	error: string | null;
}

export interface OpenData {
	title: string;
	url: string;
}

export interface SnapshotData {
	origin?: string;
	/** Map of ref id (e.g. "e2") -> { role, name }. */
	refs: Record<string, { role: string; name: string }>;
	/** Token-efficient accessibility tree text with inline `[ref=eN]` markers. */
	snapshot: string;
}

// ─── Errors ──────────────────────────────────────────────────────────

export class AgentBrowserError extends Error {
	constructor(
		message: string,
		readonly code: string,
	) {
		super(message);
		this.name = "AgentBrowserError";
	}
}

// ─── Binary resolution ───────────────────────────────────────────────

/**
 * Resolve the `agent-browser` executable. Tries, in order:
 *   1. The sidecar's own node_modules/.bin (walking up from this module).
 *   2. A bare `agent-browser` on PATH (global npm / Homebrew / Cargo install).
 * Returns the resolved command string; throws if nothing is found.
 */
function resolveAgentBrowserBinary(): string {
	const binName =
		process.platform === "win32" ? "agent-browser.cmd" : "agent-browser";

	// Walk up from this module looking for node_modules/.bin/agent-browser.
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 8; i++) {
		const candidate = join(dir, "node_modules", ".bin", binName);
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	// Fall back to PATH resolution (global install). spawn will throw ENOENT
	// at call time if it is genuinely absent — surfaced as a tool error.
	return "agent-browser";
}

// ─── Executor ────────────────────────────────────────────────────────

export interface ExecutorOptions {
	/** Idle timeout handed to the daemon via env. */
	idleTimeoutMs?: number;
	/** Comma-separated allowed-domain patterns (agent-browser --allowed-domains). */
	allowedDomains?: string;
}

export class AgentBrowserExecutor {
	private binary: string;
	private idleTimeoutMs: number;
	private allowedDomains?: string;

	constructor(opts: ExecutorOptions = {}) {
		this.binary = resolveAgentBrowserBinary();
		this.idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
		this.allowedDomains = opts.allowedDomains;
	}

	/**
	 * Run one agent-browser subcommand with `--json`, parse the envelope.
	 * Never throws for *browser-level* failures (those come back as
	 * `{ success:false, error }`); throws AgentBrowserError only for
	 * spawn / timeout / unparseable-output faults.
	 */
	private run<T>(args: string[]): AgentBrowserResult<T> {
		const fullArgs = [...args, "--json"];
		if (this.allowedDomains) {
			fullArgs.push("--allowed-domains", this.allowedDomains);
		}

		let stdout: string;
		try {
			stdout = execFileSync(this.binary, fullArgs, {
				timeout: DEFAULT_TIMEOUT_MS,
				encoding: "utf8",
				maxBuffer: 16 * 1024 * 1024,
				env: {
					...process.env,
					AGENT_BROWSER_IDLE_TIMEOUT_MS: String(this.idleTimeoutMs),
				},
			});
		} catch (err) {
			const e = err as NodeJS.ErrnoException & {
				stdout?: Buffer | string;
				signal?: string;
			};
			// agent-browser exits non-zero on browser errors but still prints a
			// JSON envelope on stdout — prefer that over a raw throw.
			const out = e.stdout?.toString().trim();
			if (out) {
				const parsed = tryParse<T>(out);
				if (parsed) return parsed;
			}
			if (e.code === "ENOENT") {
				throw new AgentBrowserError(
					`agent-browser binary not found (resolved: ${this.binary}). ` +
						"Install it as a sidecar dependency or globally (npm i -g agent-browser).",
					"binary_not_found",
				);
			}
			if (e.signal === "SIGTERM" || e.code === "ETIMEDOUT") {
				throw new AgentBrowserError(
					`agent-browser command timed out after ${DEFAULT_TIMEOUT_MS}ms: ${args.join(" ")}`,
					"timeout",
				);
			}
			throw new AgentBrowserError(
				`agent-browser command failed: ${args.join(" ")} — ${e.message}`,
				"exec_failed",
			);
		}

		const parsed = tryParse<T>(stdout.trim());
		if (!parsed) {
			throw new AgentBrowserError(
				`Could not parse agent-browser JSON output for: ${args.join(" ")}`,
				"parse_failed",
			);
		}
		return parsed;
	}

	// ─── Subcommands ───────────────────────────────────────────────────

	/** Navigate to a URL. Returns final title + URL. */
	open(url: string): AgentBrowserResult<OpenData> {
		return this.run<OpenData>(["open", url]);
	}

	/**
	 * Capture the page's accessibility tree.
	 * @param interactive only buttons/inputs/links (token-efficient, default true)
	 * @param urls include link URLs (only meaningful with interactive)
	 */
	snapshot(
		interactive = true,
		urls = false,
	): AgentBrowserResult<SnapshotData> {
		const args = ["snapshot"];
		if (interactive) args.push("-i");
		if (urls) args.push("--urls");
		return this.run<SnapshotData>(args);
	}

	/** Click an element by snapshot ref (e.g. "e2") or CSS selector. */
	click(ref: string): AgentBrowserResult<unknown> {
		return this.run(["click", normalizeRef(ref)]);
	}

	/** Type text into a field by ref or selector. */
	fill(ref: string, text: string): AgentBrowserResult<unknown> {
		return this.run(["fill", normalizeRef(ref), text]);
	}

	/** Read text content of an element by ref or selector. */
	getText(ref: string): AgentBrowserResult<unknown> {
		return this.run(["get", "text", normalizeRef(ref)]);
	}

	/** Close the browser session and shut down the daemon. */
	close(): AgentBrowserResult<unknown> {
		return this.run(["close"]);
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** agent-browser refs are passed as `@e2`; accept either form from callers. */
export function normalizeRef(ref: string): string {
	const trimmed = ref.trim();
	if (/^e\d+$/.test(trimmed)) return `@${trimmed}`;
	return trimmed; // already `@eN`, a CSS selector, or a role/text query
}

function tryParse<T>(raw: string): AgentBrowserResult<T> | null {
	try {
		const obj = JSON.parse(raw) as AgentBrowserResult<T>;
		if (typeof obj === "object" && obj !== null && "success" in obj) {
			return obj;
		}
		return null;
	} catch {
		return null;
	}
}

// ─── Singleton ───────────────────────────────────────────────────────

let _executor: AgentBrowserExecutor | null = null;

/** Lazily-constructed shared executor for the browser tool set. */
export function getAgentBrowserExecutor(): AgentBrowserExecutor {
	if (!_executor) _executor = new AgentBrowserExecutor();
	return _executor;
}
