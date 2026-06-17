/**
 * useBrowserSession — frontend half of the Browser Session (Mode B) feature.
 *
 * The sidecar's Browser Manager emits `browser_session` events (forwarded by the
 * Rust layer as a global Tauri event) whenever the managed browser's lifecycle
 * changes: starting → connected (with the live-stream WebSocket URL) → stopped.
 * This hook tracks that state so <BrowserViewport> knows when to mount and which
 * ws:// URL to connect to for frames.
 *
 * Frames do NOT come through here — the viewport opens the localhost stream
 * WebSocket directly. This hook only carries low-frequency session state.
 */

import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

export type BrowserSessionStatus = "stopped" | "starting" | "connected" | "stopping" | "error";

export interface BrowserSessionState {
	status: BrowserSessionStatus;
	/** ws:// URL for the live frame stream (present when connected). */
	streamWsUrl?: string;
	cdpPort?: number;
	currentUrl?: string;
	currentTitle?: string;
	error?: string;
}

interface BrowserSessionEventPayload {
	kind: "browser_session";
	status: BrowserSessionStatus;
	streamWsUrl?: string;
	cdpPort?: number;
	currentUrl?: string;
	currentTitle?: string;
	error?: string;
}

const INITIAL: BrowserSessionState = { status: "stopped" };

export function useBrowserSession(): BrowserSessionState {
	const [state, setState] = useState<BrowserSessionState>(INITIAL);

	useEffect(() => {
		let unlisten: (() => void) | undefined;
		let mounted = true;

		(async () => {
			const un = await listen<BrowserSessionEventPayload>("browser_session", (event) => {
				const p = event.payload;
				if (!p || p.kind !== "browser_session") return;
				setState((prev) => ({
					// Merge so a later "currentUrl"-only update doesn't drop the ws URL.
					...prev,
					status: p.status,
					streamWsUrl: p.streamWsUrl ?? (p.status === "connected" ? prev.streamWsUrl : undefined),
					cdpPort: p.cdpPort ?? prev.cdpPort,
					currentUrl: p.currentUrl ?? prev.currentUrl,
					currentTitle: p.currentTitle ?? prev.currentTitle,
					error: p.status === "error" ? p.error : undefined,
				}));
			});
			if (mounted) unlisten = un;
			else un();
		})();

		return () => {
			mounted = false;
			unlisten?.();
		};
	}, []);

	return state;
}
