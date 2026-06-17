/**
 * Browser session event sink (Mode B)
 *
 * The "Browser Session" mode (persistent managed Chromium + live viewport)
 * needs to push state to the desktop UI: when the session starts/stops, the
 * stream WebSocket URL the viewport should connect to, and the current
 * URL/action for the viewport chrome.
 *
 * Extensions don't get the sidecar's raw `send()` (that lives in index.ts), so
 * this module is a tiny decoupled sink: index.ts calls `setBrowserEventSink()`
 * once at startup to wire it to the stdout event envelope, and the browser
 * manager calls `emitBrowserEvent()` whenever session state changes. The Rust
 * layer forwards `kind: "browser_session"` events to a global Tauri event the
 * React `useBrowserSession` hook listens on.
 *
 * Frames do NOT flow through here — the viewport connects directly to
 * agent-browser's localhost stream WebSocket (ws://127.0.0.1:<port>), so only
 * low-frequency state passes through the sidecar.
 */

export type BrowserSessionStatus =
	| "starting"
	| "connected"
	| "stopping"
	| "stopped"
	| "error";

export interface BrowserSessionEvent {
	kind: "browser_session";
	/** Lifecycle state of the managed browser. */
	status: BrowserSessionStatus;
	/** WebSocket URL the viewport connects to for live frames (when connected). */
	streamWsUrl?: string;
	/** CDP debug port the agent is attached to. */
	cdpPort?: number;
	/** Current page URL (for the viewport URL bar). */
	currentUrl?: string;
	/** Current page title. */
	currentTitle?: string;
	/** Human-readable error when status === "error". */
	error?: string;
}

type Sink = (event: BrowserSessionEvent) => void;

let sink: Sink | null = null;

/** Wire the sink to the sidecar's stdout event transport (called once by index.ts). */
export function setBrowserEventSink(fn: Sink): void {
	sink = fn;
}

/** Emit a browser-session state change to the desktop UI (no-op if unwired). */
export function emitBrowserEvent(event: Omit<BrowserSessionEvent, "kind">): void {
	sink?.({ kind: "browser_session", ...event });
}
