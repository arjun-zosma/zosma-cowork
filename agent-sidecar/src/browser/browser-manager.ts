/**
 * Browser Manager — Mode B ("Browser Session")
 *
 * Owns the lifecycle of Zosma Cowork's own persistent Chromium instance: a
 * separate browser session from the user's daily browser, with a persistent
 * profile so logins (LinkedIn, Facebook, CRM, …) survive restarts. The agent
 * drives it through the existing browser tools; the desktop viewport shows it
 * live via agent-browser's stream WebSocket.
 *
 * Flow:
 *   1. launch() — spawn a Chromium/Brave/Chrome with a fixed --remote-debugging
 *      -port on a dedicated --user-data-dir; wait for the CDP endpoint.
 *   2. agent-browser connect <port> — point the default agent-browser session
 *      at the managed browser, so every browser_* tool now operates on it.
 *   3. agent-browser stream enable — open the live frame WebSocket; report the
 *      ws:// URL to the UI via emitBrowserEvent.
 *
 * Mode A (quick, ephemeral browse) is unaffected: if the manager never starts,
 * the browser tools auto-launch agent-browser's own throwaway browser as before.
 *
 * Design notes:
 *   - We launch Chromium ourselves (not via agent-browser) so we fully control
 *     the persistent profile dir and debug port — proven reliable in the
 *     2026-06-17 spike (connect → drive → stream against a real browser).
 *   - ProcessSingleton: a dedicated profile dir means our managed browser never
 *     collides with the user's daily browser instance.
 *   - On Wayland, Chromium needs --ozone-platform=wayland to surface a window;
 *     we run headless by default (the viewport IS the window) but keep the flag
 *     for the optional "show window" debug path.
 */

import { type ChildProcess, execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { getAgentBrowserExecutor } from "./agent-browser-executor.js";
import { emitBrowserEvent } from "./events.js";

/** Fixed debug port for the managed browser. Chosen high to avoid clashes. */
const MANAGED_CDP_PORT = 49222;

/** Where the persistent profile lives (cookies/logins survive restarts). */
function profileDir(): string {
	return join(homedir(), ".config", "zosma-cowork", "browser-profile");
}

/** Candidate Chromium-family binaries, in preference order. */
const BROWSER_CANDIDATES = [
	"chromium",
	"chromium-browser",
	"google-chrome",
	"google-chrome-stable",
	"brave",
	"brave-browser",
];

/** Resolve a Chromium-family browser binary on PATH (or null if none found). */
function resolveBrowserBinary(): string | null {
	// `which`-style resolution that honors PATH across platforms.
	for (const name of BROWSER_CANDIDATES) {
		try {
			const resolved = execSync(
				platform() === "win32" ? `where ${name}` : `command -v ${name}`,
				{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
			).trim();
			if (resolved) return resolved.split("\n")[0];
		} catch {
			// not found; try next
		}
	}
	return null;
}

export type ManagerState = "stopped" | "starting" | "connected" | "error";

export class BrowserManager {
	private static _instance: BrowserManager | null = null;

	private chrome: ChildProcess | null = null;
	private state: ManagerState = "stopped";
	private streamWsUrl: string | null = null;
	private lastError: string | null = null;

	static instance(): BrowserManager {
		if (!BrowserManager._instance) {
			BrowserManager._instance = new BrowserManager();
		}
		return BrowserManager._instance;
	}

	getState(): {
		state: ManagerState;
		streamWsUrl: string | null;
		cdpPort: number;
		error: string | null;
	} {
		return {
			state: this.state,
			streamWsUrl: this.streamWsUrl,
			cdpPort: MANAGED_CDP_PORT,
			error: this.lastError,
		};
	}

	/**
	 * Start (or return the already-running) managed browser session.
	 * Idempotent: a second call while connected is a no-op that re-emits state.
	 */
	async start(): Promise<{ streamWsUrl: string; cdpPort: number }> {
		if (this.state === "connected" && this.streamWsUrl) {
			emitBrowserEvent({
				status: "connected",
				streamWsUrl: this.streamWsUrl,
				cdpPort: MANAGED_CDP_PORT,
			});
			return { streamWsUrl: this.streamWsUrl, cdpPort: MANAGED_CDP_PORT };
		}

		this.state = "starting";
		this.lastError = null;
		emitBrowserEvent({ status: "starting", cdpPort: MANAGED_CDP_PORT });

		try {
			await this.launchChrome();
			await this.connectAgent();
			const streamWsUrl = await this.enableStream();

			this.streamWsUrl = streamWsUrl;
			this.state = "connected";
			emitBrowserEvent({
				status: "connected",
				streamWsUrl,
				cdpPort: MANAGED_CDP_PORT,
			});
			return { streamWsUrl, cdpPort: MANAGED_CDP_PORT };
		} catch (err) {
			this.lastError = (err as Error).message ?? String(err);
			this.state = "error";
			emitBrowserEvent({ status: "error", error: this.lastError });
			// Best-effort cleanup so a failed start doesn't strand Chromium.
			this.killChrome();
			throw err;
		}
	}

	/** Stop the managed browser session and tear down Chromium. */
	async stop(): Promise<void> {
		this.state = "stopping" as ManagerState;
		emitBrowserEvent({ status: "stopping" });
		try {
			getAgentBrowserExecutor().close();
		} catch {
			// ignore — we're tearing down anyway
		}
		this.killChrome();
		this.streamWsUrl = null;
		this.state = "stopped";
		emitBrowserEvent({ status: "stopped" });
	}

	// ─── internals ─────────────────────────────────────────────────────

	private async launchChrome(): Promise<void> {
		// Already have a live CDP endpoint? Reuse it (e.g. after a sidecar reload).
		if (await this.cdpAlive()) return;

		const binary = resolveBrowserBinary();
		if (!binary) {
			throw new Error(
				"No Chromium-family browser found (looked for chromium, chrome, brave). " +
					"Install one, or run `agent-browser install` for a bundled Chromium.",
			);
		}

		const dir = profileDir();
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

		// Default: new-headless (the in-app viewport IS the surface). Some sites
		// flag headless during login/CAPTCHA, so ZOSMA_BROWSER_HEADED=1 launches a
		// real window for maximum compatibility (it still mirrors + Take-Controls
		// in-app via CDP). Take Control works in either mode.
		const headed = process.env.ZOSMA_BROWSER_HEADED === "1";
		const args = [
			`--remote-debugging-port=${MANAGED_CDP_PORT}`,
			`--user-data-dir=${dir}`,
			"--no-first-run",
			"--no-default-browser-check",
			"--disable-features=Translate",
			"--window-size=1280,720",
		];
		if (!headed) {
			// New headless mode keeps a real compositor so screencast frames render.
			args.push("--headless=new");
		}
		if (platform() === "linux" && headed) {
			// Required to surface a real window under Wayland.
			args.push("--ozone-platform=wayland");
		}

		const child = spawn(binary, args, {
			detached: false,
			stdio: "ignore",
		});
		child.on("exit", () => {
			// If Chromium dies unexpectedly while we thought we were connected,
			// reflect that so the UI can offer a restart.
			if (this.state === "connected") {
				this.state = "stopped";
				this.streamWsUrl = null;
				emitBrowserEvent({ status: "stopped" });
			}
		});
		this.chrome = child;

		// Wait for the CDP endpoint to come up (up to ~10s).
		const deadline = Date.now() + 10_000;
		while (Date.now() < deadline) {
			if (await this.cdpAlive()) return;
			await delay(250);
		}
		throw new Error(
			`Managed browser did not expose CDP on port ${MANAGED_CDP_PORT} within 10s.`,
		);
	}

	/** True if a CDP endpoint is already answering on the managed port. */
	private async cdpAlive(): Promise<boolean> {
		try {
			const res = await fetch(
				`http://127.0.0.1:${MANAGED_CDP_PORT}/json/version`,
				{ signal: AbortSignal.timeout(1500) },
			);
			return res.ok;
		} catch {
			return false;
		}
	}

	private async connectAgent(): Promise<void> {
		const exec = getAgentBrowserExecutor();
		const res = exec.connect(MANAGED_CDP_PORT);
		if (!res.success) {
			throw new Error(
				`agent-browser failed to connect to managed browser: ${res.error ?? "unknown error"}`,
			);
		}
	}

	private async enableStream(): Promise<string> {
		const exec = getAgentBrowserExecutor();
		// `stream enable` is idempotent-ish: if already enabled it errors, so fall
		// back to `stream status` to recover the active port.
		let port: number | undefined;
		const enabled = exec.streamEnable();
		if (enabled.success && enabled.data?.port) {
			port = enabled.data.port;
		} else {
			const status = exec.streamStatus();
			if (status.success && status.data?.port) port = status.data.port;
		}
		if (!port) {
			throw new Error("Could not determine the live-stream WebSocket port.");
		}
		return `ws://127.0.0.1:${port}`;
	}

	private killChrome(): void {
		if (this.chrome && !this.chrome.killed) {
			try {
				this.chrome.kill("SIGTERM");
			} catch {
				// ignore
			}
		}
		this.chrome = null;
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}
