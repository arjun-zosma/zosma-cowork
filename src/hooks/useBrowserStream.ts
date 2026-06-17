/**
 * useBrowserStream — consumes agent-browser's live stream WebSocket.
 *
 * agent-browser's `stream enable` opens a localhost WebSocket that emits JSON
 * messages. The Tauri webview connects directly (frames never touch the
 * sidecar). Protocol (reverse-engineered from agent-browser's own dashboard):
 *
 *   { type: "frame",  data: "<base64 JPEG>" }                  ← a rendered frame
 *   { type: "status", connected, screencasting,
 *                     viewportWidth, viewportHeight, engine }  ← session status
 *   { type: "tabs",   tabs: [...] }                            ← open tabs
 *   { type: "command", ... }                                   ← command history
 *
 * Frames flow ONLY while a client is connected (screencasting flips true on
 * connect), so the stream is zero-cost when the viewport is closed/unmounted.
 *
 * We expose the latest frame as a `data:` URL (swapped via rAF to avoid frame
 * stacking) plus viewport dimensions and a coarse connection state.
 */

import { useEffect, useRef, useState } from "react";

export interface BrowserStreamState {
	/** Latest frame as a data: URL, or null before the first frame. */
	frameUrl: string | null;
	/** WebSocket connection state. */
	connection: "connecting" | "open" | "closed";
	/** True once the browser is actively screencasting (frames flowing). */
	screencasting: boolean;
	viewportWidth: number;
	viewportHeight: number;
	/** Frames received this session (debug / "is it live" heuristic). */
	frameCount: number;
}

interface StreamMessage {
	type?: string;
	data?: string;
	connected?: boolean;
	screencasting?: boolean;
	viewportWidth?: number;
	viewportHeight?: number;
}

const INITIAL: BrowserStreamState = {
	frameUrl: null,
	connection: "closed",
	screencasting: false,
	viewportWidth: 1280,
	viewportHeight: 720,
	frameCount: 0,
};

/**
 * @param wsUrl  ws:// URL to connect to, or undefined to stay disconnected.
 * @param active when false, the socket is closed (e.g. viewport minimized to a
 *               chip) so no frames are requested — keeps the stream zero-cost.
 */
export function useBrowserStream(wsUrl: string | undefined, active: boolean): BrowserStreamState {
	const [state, setState] = useState<BrowserStreamState>(INITIAL);

	// rAF-coalesced frame swap: hold the newest base64 and paint once per frame
	// so a burst of WS messages never stacks N decodes in one tick.
	const pendingFrame = useRef<string | null>(null);
	const rafRef = useRef<number | null>(null);

	useEffect(() => {
		if (!wsUrl || !active) {
			setState((s) => ({ ...s, connection: "closed" }));
			return;
		}

		let ws: WebSocket | null = null;
		let closedByUs = false;
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

		const flush = () => {
			rafRef.current = null;
			const next = pendingFrame.current;
			if (next == null) return;
			pendingFrame.current = null;
			setState((s) => ({
				...s,
				frameUrl: `data:image/jpeg;base64,${next}`,
				frameCount: s.frameCount + 1,
			}));
		};

		const connect = () => {
			setState((s) => ({ ...s, connection: "connecting" }));
			try {
				ws = new WebSocket(wsUrl);
			} catch {
				scheduleReconnect();
				return;
			}

			ws.onopen = () => setState((s) => ({ ...s, connection: "open" }));

			ws.onmessage = (ev) => {
				if (typeof ev.data !== "string") return;
				let msg: StreamMessage;
				try {
					msg = JSON.parse(ev.data);
				} catch {
					return;
				}
				if (msg.type === "frame" && typeof msg.data === "string") {
					pendingFrame.current = msg.data;
					if (rafRef.current == null) {
						rafRef.current = requestAnimationFrame(flush);
					}
				} else if (msg.type === "status") {
					setState((s) => ({
						...s,
						screencasting: msg.screencasting ?? s.screencasting,
						viewportWidth: msg.viewportWidth ?? s.viewportWidth,
						viewportHeight: msg.viewportHeight ?? s.viewportHeight,
					}));
				}
			};

			ws.onclose = () => {
				setState((s) => ({ ...s, connection: "closed" }));
				if (!closedByUs) scheduleReconnect();
			};
			ws.onerror = () => {
				// onclose will follow; let it handle reconnect.
				try {
					ws?.close();
				} catch {
					/* ignore */
				}
			};
		};

		const scheduleReconnect = () => {
			if (closedByUs) return;
			reconnectTimer = setTimeout(connect, 1000);
		};

		connect();

		return () => {
			closedByUs = true;
			if (reconnectTimer) clearTimeout(reconnectTimer);
			if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
			pendingFrame.current = null;
			try {
				ws?.close();
			} catch {
				/* ignore */
			}
		};
	}, [wsUrl, active]);

	return state;
}
