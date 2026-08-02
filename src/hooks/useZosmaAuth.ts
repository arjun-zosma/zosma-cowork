/**
 * useZosmaAuth — Zosma Router auth hook.
 *
 * Strict deep-link parser, duplicate-delivery guard, state machine:
 *   idle → starting → waiting_browser → completing → done
 *                                            ↘ error
 *         cancel → idle
 *
 * Security: NEVER expose PKCE verifier, auth code, state param,
 * device key, or Google token in phase, error, or hooks state.
 */

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

export type Phase = "idle" | "starting" | "waiting_browser" | "completing" | "done" | "error";

export interface ZosmaAuthResult {
	providerId: string;
	selectedModelId: string;
	modelCount: number;
}

export interface UseZosmaAuthOptions {
	onComplete?: () => void;
}

interface ParsedDeepLink {
	code: string;
	state: string;
}

// ── Pure deep-link parser ──────────────────────────────────────────────────

/**
 * Parse and validate a deep-link URL.
 *
 * Accepted shape:
 *   ai.zosma.cowork://oauth/callback?code=<one>&state=<one>
 *
 * Rejects:
 *   - Wrong scheme, host, or path
 *   - Missing/empty code or state
 *   - Duplicate query parameters
 *   - Extra query parameters beyond code+state
 */
export function parseDeepLink(url: string): ParsedDeepLink | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}

	// Scheme: ai.zosma.cowork (Tauri strips the trailing colon)
	if (parsed.protocol !== "ai.zosma.cowork:") return null;

	// Host: oauth
	if (parsed.hostname !== "oauth") return null;

	// Path: /callback
	if (parsed.pathname !== "/callback") return null;

	// Exactly one code and one state, no duplicate params, no extra params
	const code = parsed.searchParams.get("code");
	const state = parsed.searchParams.get("state");

	if (!code || !state) return null;
	if (parsed.searchParams.getAll("code").length !== 1) return null;
	if (parsed.searchParams.getAll("state").length !== 1) return null;

	// Only code and state params allowed
	let paramCount = 0;
	for (const _key of parsed.searchParams.keys()) {
		paramCount++;
	}
	if (paramCount > 2) return null;

	return { code, state };
}

// ── Safe error helper ──────────────────────────────────────────────────────

export function safeError(err: unknown): string {
	const msg = err instanceof Error ? err.message : String(err);
	// Map common error messages to user-safe text
	if (msg.includes("no pending") || msg.includes("expired")) {
		return "Sign-in session expired. Please try again.";
	}
	if (msg.includes("state mismatch")) {
		return "Something went wrong. Please try signing in again.";
	}
	if (msg.includes("not ready")) {
		return "The AI engine is starting up. Please try again in a moment.";
	}
	if (msg.includes("timeout")) {
		return "Request timed out. Please check your connection and try again.";
	}
	if (msg.includes("sidecar")) {
		return "Connection error. Please restart the app and try again.";
	}
	// Generic fallback — never raw backend message
	return "Something went wrong. Please try again.";
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useZosmaAuth(options: UseZosmaAuthOptions = {}) {
	const { onComplete } = options;
	const [phase, setPhase] = useState<Phase>("idle");
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<ZosmaAuthResult | null>(null);

	// Duplicate-delivery guard: keyed by "code:state"
	const completedRef = useRef<Set<string>>(new Set());
	const unlistenRef = useRef<(() => void) | null>(null);
	const mountedRef = useRef(true);

	// ── complete function ──────────────────────────────────────────────────

	const complete = useCallback(
		async (code: string, state: string) => {
			const key = `${code}:${state}`;
			if (completedRef.current.has(key)) return;
			completedRef.current.add(key);

			setPhase("completing");
			setError(null);
			try {
				const res = await invoke<ZosmaAuthResult>("complete_zosma_auth", {
					code,
					state,
				});
				if (!mountedRef.current) return;
				setResult(res);
				setPhase("done");
				window.dispatchEvent(new CustomEvent("config-reload"));
				onComplete?.();
			} catch (err) {
				if (!mountedRef.current) return;
				setPhase("error");
				setError(safeError(err));
			}
		},
		[onComplete],
	);

	// ── Deep-link listener ─────────────────────────────────────────────────

	useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				const mod = await import("@tauri-apps/plugin-deep-link");

				// Check for launch URLs
				try {
					const urls = await mod.getCurrent();
					if (urls && urls.length > 0 && !cancelled) {
						for (const url of urls) {
							const parsed = parseDeepLink(url);
							if (parsed) {
								await complete(parsed.code, parsed.state);
							}
						}
					}
				} catch {
					// getCurrent may fail in dev environment without deep-link support
				}

				// Listen for future deep links
				if (!cancelled) {
					const unlisten = await mod.onOpenUrl((urls: string[]) => {
						for (const url of urls) {
							const parsed = parseDeepLink(url);
							if (parsed) {
								complete(parsed.code, parsed.state);
							}
						}
					});
					if (!cancelled) {
						unlistenRef.current = unlisten;
					} else {
						unlisten();
					}
				}
			} catch {
				// Import may fail in test or non-Tauri env
			}
		})();

		return () => {
			cancelled = true;
			mountedRef.current = false;
			unlistenRef.current?.();
			unlistenRef.current = null;
		};
	}, [complete]);

	// ── start function ─────────────────────────────────────────────────────

	const start = useCallback(async () => {
		setPhase("starting");
		setError(null);
		try {
			const { authorizationUrl } = await invoke<{ authorizationUrl: string }>("start_zosma_auth");

			// Backend creates this URL; restrict it to an HTTP(S) cowork transaction,
			// while allowing the local router used during development.
			const parsed = new URL(authorizationUrl);
			if (
				!["http:", "https:"].includes(parsed.protocol) ||
				parsed.pathname !== "/connect/cowork" ||
				!parsed.searchParams.get("transaction")
			) {
				throw new Error("invalid authorization URL");
			}

			await invoke("open_url", { url: authorizationUrl });
			setPhase("waiting_browser");
		} catch (err) {
			setPhase("error");
			setError(safeError(err));
		}
	}, []);

	// ── cancel function ────────────────────────────────────────────────────

	const cancel = useCallback(async () => {
		try {
			await invoke("cancel_zosma_auth");
		} catch {
			// Best-effort — clear local state regardless
		}
		setPhase("idle");
		setError(null);
	}, []);

	// ── reset function ─────────────────────────────────────────────────────

	const reset = useCallback(() => {
		setPhase("idle");
		setError(null);
		setResult(null);
	}, []);

	return { phase, error, result, start, cancel, reset };
}
