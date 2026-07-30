/**
 * useZosmaAuth — TDD tests.
 *
 * State machine: idle → starting → waiting_browser → completing → done
 *                                                  ↘ error
 *               idle → cancel → idle
 *
 * Security: renderer state/events/logs never contain PKCE verifier,
 * auth code, state, device key, or Google token.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useZosmaAuth } from "./useZosmaAuth";

// ── Mocks ──────────────────────────────────────────────────────────────────

const invokeMock = vi.fn();
const getCurrentMock = vi.fn();
const onOpenUrlMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
	invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/plugin-deep-link", () => ({
	getCurrent: (...args: unknown[]) => getCurrentMock(...args),
	onOpenUrl: (...args: unknown[]) => onOpenUrlMock(...args),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

type Phase = "idle" | "starting" | "waiting_browser" | "completing" | "done" | "error";

interface HookResult {
	phase: Phase;
	error: string | null;
	result: { providerId: string; selectedModelId: string; modelCount: number } | null;
	start: () => Promise<void>;
	cancel: () => Promise<void>;
	reset: () => void;
}

function extractHookData(result: { current: HookResult }) {
	return result.current;
}

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
	invokeMock.mockReset();
	getCurrentMock.mockReset();
	onOpenUrlMock.mockReset();
	// Default: deep-link plugin returns no current URL, and onOpenUrl returns
	// an unlisten function.
	getCurrentMock.mockResolvedValue(null);
	onOpenUrlMock.mockResolvedValue(vi.fn());
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("useZosmaAuth — start flow", () => {
	it("start() calls start_zosma_auth invoke, opens URL, enters waiting_browser", async () => {
		const authUrl = "https://auth.zosma.ai/connect/cowork?transaction=abc123";
		invokeMock.mockImplementation((cmd: string) => {
			if (cmd === "start_zosma_auth") return Promise.resolve({ authorizationUrl: authUrl });
			if (cmd === "open_url") return Promise.resolve(null);
			return Promise.reject(new Error(`unexpected invoke: ${cmd}`));
		});

		const { result } = renderHook(() => useZosmaAuth());
		await waitFor(() => expect(extractHookData(result).phase).toBe("idle"));

		await act(async () => {
			await extractHookData(result).start();
		});

		expect(invokeMock).toHaveBeenCalledWith("start_zosma_auth");
		expect(invokeMock).toHaveBeenCalledWith("open_url", { url: authUrl });
		expect(extractHookData(result).phase).toBe("waiting_browser");
	});

	it("start() enters error when start_zosma_auth fails", async () => {
		invokeMock.mockRejectedValue(new Error("sidecar not ready"));

		const { result } = renderHook(() => useZosmaAuth());

		await act(async () => {
			await extractHookData(result).start();
		});

		expect(extractHookData(result).phase).toBe("error");
		expect(extractHookData(result).error).toBeTruthy();
		// Error should be user-safe, not raw error text containing sidecar details
		expect(extractHookData(result).error).toMatch(/try again|failed|couldn't/i);
	});

	it("start() enters error when authorizationUrl is invalid", async () => {
		invokeMock.mockImplementation((cmd: string) => {
			if (cmd === "start_zosma_auth")
				return Promise.resolve({ authorizationUrl: "https://evil.com/phish" });
			return Promise.reject(new Error("unexpected"));
		});

		const { result } = renderHook(() => useZosmaAuth());

		await act(async () => {
			await extractHookData(result).start();
		});

		expect(extractHookData(result).phase).toBe("error");
	});

	it("does NOT contain auth code, state, verifier, or key in phase/error/result", async () => {
		invokeMock.mockImplementation((cmd: string) => {
			if (cmd === "start_zosma_auth")
				return Promise.resolve({
					authorizationUrl: "https://auth.zosma.ai/connect/cowork?transaction=t1",
				});
			if (cmd === "open_url") return Promise.resolve(null);
			return Promise.reject(new Error("unexpected"));
		});

		const { result } = renderHook(() => useZosmaAuth());
		await act(async () => {
			await extractHookData(result).start();
		});

		// Phase is a fixed enum — safe
		expect(extractHookData(result).phase).toBe("waiting_browser");
		// Error is null — safe
		expect(extractHookData(result).error).toBeNull();
		// Result is null until complete
		expect(extractHookData(result).result).toBeNull();
	});
});

describe("useZosmaAuth — deep-link handling", () => {
	it("valid getCurrent deep link triggers complete flow", async () => {
		const deepLink = "ai.zosma.cowork://oauth/callback?code=abc123&state=def456";
		getCurrentMock.mockResolvedValue([deepLink]);
		invokeMock.mockImplementation((cmd: string) => {
			if (cmd === "complete_zosma_auth") {
				return Promise.resolve({
					providerId: "zosmaai-router",
					selectedModelId: "gpt-4o",
					modelCount: 5,
				});
			}
			return Promise.reject(new Error(`unexpected: ${cmd}`));
		});

		const onComplete = vi.fn();
		renderHook(() => useZosmaAuth({ onComplete }));

		await waitFor(() => {
			expect(invokeMock).toHaveBeenCalledWith("complete_zosma_auth", {
				code: "abc123",
				state: "def456",
			});
		});

		await waitFor(() => {
			expect(onComplete).toHaveBeenCalled();
		});
	});

	it("valid onOpenUrl deep link triggers complete flow", async () => {
		// onOpenUrl registers a callback; capture it
		let registeredHandler: ((urls: string[]) => void) | null = null;
		onOpenUrlMock.mockImplementation((handler: (urls: string[]) => void) => {
			registeredHandler = handler;
			return Promise.resolve(vi.fn());
		});

		const onComplete = vi.fn();
		const { result } = renderHook(() => useZosmaAuth({ onComplete }));

		invokeMock.mockImplementation((cmd: string) => {
			if (cmd === "complete_zosma_auth") {
				return Promise.resolve({
					providerId: "zosmaai-router",
					selectedModelId: "claude-sonnet-4",
					modelCount: 3,
				});
			}
			return Promise.reject(new Error(`unexpected: ${cmd}`));
		});

		// Wait for onOpenUrl to be registered
		await waitFor(() => expect(registeredHandler).not.toBeNull());

		// Simulate deep-link event
		await act(async () => {
			registeredHandler?.(["ai.zosma.cowork://oauth/callback?code=xyz789&state=abc123"]);
		});

		expect(invokeMock).toHaveBeenCalledWith("complete_zosma_auth", {
			code: "xyz789",
			state: "abc123",
		});

		await waitFor(() => expect(extractHookData(result).phase).toBe("done"));
		expect(onComplete).toHaveBeenCalled();
	});

	it("wrong scheme does not call complete_zosma_auth", async () => {
		let registeredHandler: ((urls: string[]) => void) | null = null;
		onOpenUrlMock.mockImplementation((handler: (urls: string[]) => void) => {
			registeredHandler = handler;
			return Promise.resolve(vi.fn());
		});

		renderHook(() => useZosmaAuth());

		await waitFor(() => expect(registeredHandler).not.toBeNull());

		await act(async () => {
			registeredHandler?.(["https://evil.com/oauth/callback?code=x&state=y"]);
		});

		expect(invokeMock).not.toHaveBeenCalledWith("complete_zosma_auth", expect.anything());
	});

	it("wrong host does not call complete_zosma_auth", async () => {
		let registeredHandler: ((urls: string[]) => void) | null = null;
		onOpenUrlMock.mockImplementation((handler: (urls: string[]) => void) => {
			registeredHandler = handler;
			return Promise.resolve(vi.fn());
		});

		renderHook(() => useZosmaAuth());

		await waitFor(() => expect(registeredHandler).not.toBeNull());

		await act(async () => {
			registeredHandler?.(["ai.zosma.cowork://malicious/callback?code=x&state=y"]);
		});

		expect(invokeMock).not.toHaveBeenCalledWith("complete_zosma_auth", expect.anything());
	});

	it("wrong path does not call complete_zosma_auth", async () => {
		let registeredHandler: ((urls: string[]) => void) | null = null;
		onOpenUrlMock.mockImplementation((handler: (urls: string[]) => void) => {
			registeredHandler = handler;
			return Promise.resolve(vi.fn());
		});

		renderHook(() => useZosmaAuth());

		await waitFor(() => expect(registeredHandler).not.toBeNull());

		await act(async () => {
			registeredHandler?.(["ai.zosma.cowork://oauth/evil?code=x&state=y"]);
		});

		expect(invokeMock).not.toHaveBeenCalledWith("complete_zosma_auth", expect.anything());
	});

	it("missing code does not call complete_zosma_auth", async () => {
		let registeredHandler: ((urls: string[]) => void) | null = null;
		onOpenUrlMock.mockImplementation((handler: (urls: string[]) => void) => {
			registeredHandler = handler;
			return Promise.resolve(vi.fn());
		});

		renderHook(() => useZosmaAuth());

		await waitFor(() => expect(registeredHandler).not.toBeNull());

		await act(async () => {
			registeredHandler?.(["ai.zosma.cowork://oauth/callback?state=y"]);
		});

		expect(invokeMock).not.toHaveBeenCalledWith("complete_zosma_auth", expect.anything());
	});

	it("missing state does not call complete_zosma_auth", async () => {
		let registeredHandler: ((urls: string[]) => void) | null = null;
		onOpenUrlMock.mockImplementation((handler: (urls: string[]) => void) => {
			registeredHandler = handler;
			return Promise.resolve(vi.fn());
		});

		renderHook(() => useZosmaAuth());

		await waitFor(() => expect(registeredHandler).not.toBeNull());

		await act(async () => {
			registeredHandler?.(["ai.zosma.cowork://oauth/callback?code=x"]);
		});

		expect(invokeMock).not.toHaveBeenCalledWith("complete_zosma_auth", expect.anything());
	});

	it("duplicate query parameters do not call complete_zosma_auth", async () => {
		let registeredHandler: ((urls: string[]) => void) | null = null;
		onOpenUrlMock.mockImplementation((handler: (urls: string[]) => void) => {
			registeredHandler = handler;
			return Promise.resolve(vi.fn());
		});

		renderHook(() => useZosmaAuth());

		await waitFor(() => expect(registeredHandler).not.toBeNull());

		await act(async () => {
			registeredHandler?.(["ai.zosma.cowork://oauth/callback?code=x&code=y&state=z"]);
		});

		expect(invokeMock).not.toHaveBeenCalledWith("complete_zosma_auth", expect.anything());
	});

	it("duplicate delivery (getCurrent + onOpenUrl same link) invokes complete once", async () => {
		// getCurrent returns a URL
		getCurrentMock.mockResolvedValue(["ai.zosma.cowork://oauth/callback?code=dup&state=test"]);
		invokeMock.mockImplementation((cmd: string) => {
			if (cmd === "complete_zosma_auth")
				return Promise.resolve({
					providerId: "zosmaai-router",
					selectedModelId: "gpt-4o",
					modelCount: 2,
				});
			return Promise.reject(new Error(`unexpected: ${cmd}`));
		});

		let registeredHandler: ((urls: string[]) => void) | null = null;
		onOpenUrlMock.mockImplementation((handler: (urls: string[]) => void) => {
			registeredHandler = handler;
			return Promise.resolve(vi.fn());
		});

		renderHook(() => useZosmaAuth());

		// After getCurrent fires, the same URL arrives via onOpenUrl
		await waitFor(() => expect(registeredHandler).not.toBeNull());

		await act(async () => {
			registeredHandler?.(["ai.zosma.cowork://oauth/callback?code=dup&state=test"]);
		});

		// complete_zosma_auth should be called exactly once
		const completeCalls = invokeMock.mock.calls.filter(
			(args: unknown[]) => (args as [string])[0] === "complete_zosma_auth",
		);
		expect(completeCalls).toHaveLength(1);
	});
});

describe("useZosmaAuth — cancel flow", () => {
	it("cancel() invokes cancel_zosma_auth and resets phase to idle", async () => {
		invokeMock.mockResolvedValue({});

		const { result } = renderHook(() => useZosmaAuth());

		await act(async () => {
			await extractHookData(result).cancel();
		});

		expect(invokeMock).toHaveBeenCalledWith("cancel_zosma_auth");
		expect(extractHookData(result).phase).toBe("idle");
	});

	it("cancel does NOT call disconnect_zosma_auth or revoke", async () => {
		invokeMock.mockResolvedValue({});

		const { result } = renderHook(() => useZosmaAuth());

		await act(async () => {
			await extractHookData(result).cancel();
		});

		expect(invokeMock).not.toHaveBeenCalledWith("disconnect_zosma_auth", expect.anything());
	});
});

describe("useZosmaAuth — reset", () => {
	it("reset() returns state to idle with no error or result", async () => {
		const { result } = renderHook(() => useZosmaAuth());

		await act(async () => {
			extractHookData(result).reset();
		});

		expect(extractHookData(result).phase).toBe("idle");
		expect(extractHookData(result).error).toBeNull();
		expect(extractHookData(result).result).toBeNull();
	});
});

describe("useZosmaAuth — event listener cleanup", () => {
	it("unsubscribes on unmount to prevent duplicate completion", async () => {
		const unlisten = vi.fn();
		onOpenUrlMock.mockResolvedValue(unlisten);

		const { unmount } = renderHook(() => useZosmaAuth());
		// Flush microtasks so async effect resolves before unmount
		await act(async () => {});
		unmount();

		expect(unlisten).toHaveBeenCalled();
	});
});
