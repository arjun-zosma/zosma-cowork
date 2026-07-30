import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Extension UI bridge (frontend half).
 *
 * pi extensions drive the user through abstract `ctx.ui.*` calls. The
 * sidecar's uiContext bridge emits each call as a global `ui_request` Tauri
 * event ({ kind, method, id, ... }); dialog methods then wait for a
 * `ui_response` we send back via the `send_ui_response` command.
 *
 * Two protocol families flow through here:
 *
 *  1. **Dialog** methods (select / confirm / input / editor) — queued and
 *     shown one at a time; resolved via `respond()`.
 *  2. **Fire-and-forget** methods (notify / setStatus / setWidget / setTitle /
 *     set_editor_text + the Tier-2 working indicators) — no response expected;
 *     rendered as ambient surfaces (toasts, footer chips, widget cards, a
 *     working badge). These used to be dropped; this hook now renders them so
 *     existing pi extensions light up in Cowork without any extension changes.
 *
 * This is Cowork implementing more of pi's ExtensionUIContext / RPC
 * Extension-UI protocol as a first-class GUI renderer — same contract pi's TUI
 * implements, different surface.
 */

export type ExtensionUiMethod = "select" | "confirm" | "input" | "editor";

export interface ExtensionUiRequest {
	kind: "ui_request";
	id: string;
	method: ExtensionUiMethod | string;
	title?: string;
	message?: string;
	options?: string[];
	placeholder?: string;
	prefill?: string;
	timeout?: number;
	notifyType?: "info" | "warning" | "error";
	// Fire-and-forget payloads (mirror the sidecar's emitUiRequest shapes).
	statusKey?: string;
	statusText?: string;
	widgetKey?: string;
	widgetLines?: string[];
	widgetPlacement?: "aboveEditor" | "belowEditor";
	text?: string;
	// Tier-2 working indicators.
	workingMessage?: string;
	workingVisible?: boolean;
	workingLabel?: string;
}

export interface ExtensionUiResponse {
	value?: string;
	confirmed?: boolean;
	cancelled?: boolean;
}

/** A transient notification surfaced as a toast. */
export interface ExtensionToast {
	id: string;
	message: string;
	type: "info" | "warning" | "error";
}

/** A persistent status entry keyed by `statusKey` (footer chips). */
export interface ExtensionStatus {
	key: string;
	text: string;
}

/** A persistent widget keyed by `widgetKey` (cards above the composer). */
export interface ExtensionWidget {
	key: string;
	lines: string[];
	placement: "aboveEditor" | "belowEditor";
}

/** Ambient "extension is working" indicator. */
export interface ExtensionWorking {
	visible: boolean;
	message?: string;
	label?: string;
}

const DIALOG_METHODS = new Set<string>(["select", "confirm", "input", "editor"]);

function isDialogRequest(req: ExtensionUiRequest): boolean {
	return DIALOG_METHODS.has(req.method);
}

/** How long a notify() toast stays before auto-dismissing. */
const TOAST_TTL_MS = 6000;

export function useExtensionUi() {
	// FIFO queue of pending interactive dialogs. The head is the one shown.
	const [queue, setQueue] = useState<ExtensionUiRequest[]>([]);

	// Ambient fire-and-forget surfaces.
	const [toasts, setToasts] = useState<ExtensionToast[]>([]);
	const [statuses, setStatuses] = useState<ExtensionStatus[]>([]);
	const [widgets, setWidgets] = useState<ExtensionWidget[]>([]);
	const [working, setWorking] = useState<ExtensionWorking>({ visible: false });

	// Per-toast auto-dismiss timers, cleared on unmount.
	const toastTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

	// Drop a request from the queue by id (used by ui_cancel and by respond()).
	const removeFromQueue = useCallback((id: string) => {
		setQueue((prev) => prev.filter((r) => r.id !== id));
	}, []);

	const dismissToast = useCallback((id: string) => {
		setToasts((prev) => prev.filter((t) => t.id !== id));
		const timer = toastTimers.current.get(id);
		if (timer) {
			clearTimeout(timer);
			toastTimers.current.delete(id);
		}
	}, []);

	/** Upsert-or-clear a keyed entry (status / widget) in a list. */
	const applyFireAndForget = useCallback((req: ExtensionUiRequest) => {
		switch (req.method) {
			case "notify": {
				const toast: ExtensionToast = {
					id: req.id,
					message: req.message ?? "",
					type: req.notifyType ?? "info",
				};
				setToasts((prev) => [...prev, toast]);
				const timer = setTimeout(() => {
					setToasts((cur) => cur.filter((t) => t.id !== toast.id));
					toastTimers.current.delete(toast.id);
				}, TOAST_TTL_MS);
				toastTimers.current.set(toast.id, timer);
				break;
			}
			case "setStatus": {
				const key = req.statusKey;
				if (!key) break;
				setStatuses((prev) => {
					const rest = prev.filter((s) => s.key !== key);
					// Undefined/empty text clears the entry.
					return req.statusText ? [...rest, { key, text: req.statusText }] : rest;
				});
				break;
			}
			case "setWidget": {
				const key = req.widgetKey;
				if (!key) break;
				setWidgets((prev) => {
					const rest = prev.filter((w) => w.key !== key);
					return req.widgetLines && req.widgetLines.length > 0
						? [
								...rest,
								{
									key,
									lines: req.widgetLines,
									placement: req.widgetPlacement ?? "aboveEditor",
								},
							]
						: rest;
				});
				break;
			}
			case "setTitle": {
				if (typeof req.title === "string") document.title = req.title;
				break;
			}
			case "set_editor_text": {
				// Hand off to the composer; MessageInput listens for this.
				window.dispatchEvent(new CustomEvent("cowork:set-editor-text", { detail: req.text ?? "" }));
				break;
			}
			// ── Tier 2: working indicators ─────────────────────────────────
			case "setWorkingMessage": {
				setWorking((w) => ({ ...w, message: req.workingMessage, visible: true }));
				break;
			}
			case "setWorkingVisible": {
				setWorking((w) => ({ ...w, visible: Boolean(req.workingVisible) }));
				break;
			}
			case "setWorkingIndicator": {
				setWorking((w) => ({
					...w,
					visible: true,
					message: req.workingMessage ?? w.message,
				}));
				break;
			}
			case "setHiddenThinkingLabel": {
				setWorking((w) => ({ ...w, label: req.workingLabel }));
				break;
			}
			default:
				break;
		}
	}, []);

	useEffect(() => {
		let mounted = true;
		const unlisteners: Array<() => void> = [];
		const timers = toastTimers.current;

		(async () => {
			const uRequest = await listen<ExtensionUiRequest>("ui_request", (event) => {
				const req = event.payload;
				if (!req || typeof req.id !== "string") return;
				if (isDialogRequest(req)) {
					setQueue((prev) => [...prev, req]);
				} else {
					applyFireAndForget(req);
				}
			});
			// The sidecar resolved a dialog itself (timeout/abort) → dismiss it.
			const uCancel = await listen<{ id?: string }>("ui_cancel", (event) => {
				const id = event.payload?.id;
				if (typeof id === "string") {
					removeFromQueue(id);
					// A cancelled notify should also clear its toast.
					setToasts((prev) => prev.filter((t) => t.id !== id));
				}
			});
			if (!mounted) {
				uRequest();
				uCancel();
				return;
			}
			unlisteners.push(uRequest, uCancel);
		})();

		return () => {
			mounted = false;
			for (const u of unlisteners) u();
			for (const timer of timers.values()) clearTimeout(timer);
			timers.clear();
		};
	}, [removeFromQueue, applyFireAndForget]);

	const current = queue[0] ?? null;

	const respond = useCallback(
		(response: ExtensionUiResponse) => {
			if (!current) return;
			const id = current.id;
			// Pop head first so the next queued dialog (if any) renders even if the
			// IPC call is slow or rejects.
			setQueue((prev) => prev.slice(1));
			void invoke("send_ui_response", {
				id,
				value: response.value,
				confirmed: response.confirmed,
				cancelled: response.cancelled,
			}).catch(() => {
				// Sidecar may have moved on (timeout/abort) — the pending promise is
				// already resolved, so a dropped response is harmless.
			});
		},
		[current],
	);

	return {
		current,
		respond,
		toasts,
		dismissToast,
		statuses,
		widgets,
		working,
	};
}
