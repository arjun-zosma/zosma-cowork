/**
 * Tests for ZosmaStatus — connected-account controls in Settings.
 *
 * Stage 5 of the Zosma Router Auth integration.
 * Renders usage, refresh, reconnect, and disconnect for the managed provider.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZosmaStatus } from "./ZosmaStatus";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
	invoke: (...args: unknown[]) => invokeMock(...args),
}));

/** Build a mock AuthStatus with zosmaai-router in apiKeyProviders. */
function connectedAuth(): Record<string, unknown> {
	return {
		providers: [],
		supported: [],
		apiKeyProviders: [{ id: "zosmaai-router", displayName: "Zosma AI" }, { id: "anthropic", displayName: "Anthropic" }],
	};
}

function disconnectedAuth(): Record<string, unknown> {
	return {
		providers: [],
		supported: [],
		apiKeyProviders: [{ id: "anthropic", displayName: "Anthropic" }],
	};
}

describe("ZosmaStatus", () => {
	beforeEach(() => {
		invokeMock.mockReset();
		invokeMock.mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// ── connected state ────────────────────────────────────────────────────

	it("renders connected status when zosmaai-router is in apiKeyProviders", async () => {
		invokeMock.mockImplementation((cmd: string) => {
			if (cmd === "get_zosma_usage") {
				return Promise.resolve({ plan: "pro", used: 42, limit: 1000, resetAt: "2026-08-01T00:00:00Z" });
			}
			return Promise.resolve(undefined);
		});

		const authStatus = connectedAuth();
		render(<ZosmaStatus authStatus={authStatus} onChange={vi.fn()} />);

		await waitFor(() => {
			expect(screen.getByText("Zosma AI (Router)")).toBeTruthy();
		});
		expect(screen.getByText("Connected")).toBeTruthy();
	});

	it("renders safe usage DTO without raw keys or identifiers", async () => {
		invokeMock.mockImplementation((cmd: string) => {
			if (cmd === "get_zosma_usage") {
				return Promise.resolve({ plan: "pro", used: 42, limit: 1000, resetAt: "2026-08-01T00:00:00Z" });
			}
			return Promise.resolve(undefined);
		});

		render(<ZosmaStatus authStatus={connectedAuth()} onChange={vi.fn()} />);

		await waitFor(() => {
			expect(screen.getByText(/Usage: 42 \/ 1,000/)).toBeTruthy();
		});
		expect(screen.getByText(/pro/i)).toBeTruthy();
		// No raw keys, tokens, or device IDs
		const text = document.body.textContent ?? "";
		expect(text).not.toContain("sk-");
		expect(text).not.toContain("Bearer");
		expect(text).not.toContain("device-id");
	});

	it("renders 'No usage data' when get_zosma_usage returns empty", async () => {
		invokeMock.mockImplementation((cmd: string) => {
			if (cmd === "get_zosma_usage") {
				return Promise.resolve({});
			}
			return Promise.resolve(undefined);
		});

		render(<ZosmaStatus authStatus={connectedAuth()} onChange={vi.fn()} />);

		await waitFor(() => {
			expect(screen.getByText(/usage/i)).toBeTruthy();
		});
	});

	it("shows refresh button that calls refresh_zosma_models", async () => {
		const refreshImpl = vi.fn().mockResolvedValue({ modelCount: 15, selectedModelId: "p/some-model" });
		const usageImpl = vi.fn()
			.mockResolvedValueOnce({ used: 10, limit: 100 }) // initial mount
			.mockResolvedValueOnce({ used: 50, limit: 200 }); // after refresh

		invokeMock.mockImplementation((cmd: string) => {
			if (cmd === "get_zosma_usage") return usageImpl();
			if (cmd === "refresh_zosma_models") return refreshImpl();
			return Promise.resolve(undefined);
		});

		const onChange = vi.fn();
		render(<ZosmaStatus authStatus={connectedAuth()} onChange={onChange} />);

		// Wait for initial usage to render
		await waitFor(() => {
			expect(screen.getByText(/Usage: 10 \/ 100/)).toBeTruthy();
		});

		// Model count is only shown after a refresh, not on initial load
		expect(screen.queryByText(/models/i)).toBeNull();

		// Click refresh
		fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

		await waitFor(() => {
			expect(refreshImpl).toHaveBeenCalled();
			expect(onChange).toHaveBeenCalled();
		});

		// After refresh, model count should appear
		await waitFor(() => {
			expect(screen.getByText(/15 models/i)).toBeTruthy();
		});
	});

	it("shows error state when refresh fails", async () => {
		invokeMock.mockImplementation((cmd: string) => {
			if (cmd === "get_zosma_usage") {
				return Promise.resolve({ used: 10, limit: 100 });
			}
			if (cmd === "refresh_zosma_models") {
				return Promise.reject(new Error("server timeout"));
			}
			return Promise.resolve(undefined);
		});

		render(<ZosmaStatus authStatus={connectedAuth()} onChange={vi.fn()} />);

		await waitFor(() => {
			expect(screen.getByText(/refresh/i)).toBeTruthy();
		});

		fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

		await waitFor(() => {
			expect(screen.getByText(/server timeout/i)).toBeTruthy();
		});
	});

	// ── disconnect ────────────────────────────────────────────────────────

	it("shows confirmation before disconnect", async () => {
		invokeMock.mockResolvedValue(Promise.resolve({}));
		render(<ZosmaStatus authStatus={connectedAuth()} onChange={vi.fn()} />);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /disconnect/i })).toBeTruthy();
		});

		fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));

		await waitFor(() => {
			expect(screen.getByText(/are you sure/i)).toBeTruthy();
		});
	});

	it("disconnect removes provider and calls onChange", async () => {
		invokeMock.mockImplementation((cmd: string) => {
			if (cmd === "get_zosma_usage") {
				return Promise.resolve({});
			}
			if (cmd === "disconnect_zosma_auth") {
				return Promise.resolve({ disconnected: true });
			}
			return Promise.resolve(undefined);
		});

		const onChange = vi.fn();
		render(<ZosmaStatus authStatus={connectedAuth()} onChange={onChange} />);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /disconnect/i })).toBeTruthy();
		});

		// Click disconnect → shows confirm dialog
		fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));
		await waitFor(() => {
			expect(screen.getByText(/are you sure/i)).toBeTruthy();
		});

		// Click confirm
		fireEvent.click(screen.getByRole("button", { name: /confirm disconnect/i }));

		await waitFor(() => {
			expect(invokeMock).toHaveBeenCalledWith("disconnect_zosma_auth");
			expect(onChange).toHaveBeenCalled();
		});
	});

	it("disconnect confirmation cancel does not invoke disconnect", async () => {
		invokeMock.mockImplementation((cmd: string) => {
			if (cmd === "get_zosma_usage") {
				return Promise.resolve({});
			}
			return Promise.resolve(undefined);
		});

		render(<ZosmaStatus authStatus={connectedAuth()} onChange={vi.fn()} />);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /disconnect/i })).toBeTruthy();
		});

		fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));
		await waitFor(() => {
			expect(screen.getByText(/are you sure/i)).toBeTruthy();
		});

		fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
		expect(invokeMock).not.toHaveBeenCalledWith("disconnect_zosma_auth");
	});

	it("server-failure disconnect still removes provider locally", async () => {
		invokeMock.mockImplementation((cmd: string) => {
			if (cmd === "get_zosma_usage") {
				return Promise.resolve({});
			}
			if (cmd === "disconnect_zosma_auth") {
				return Promise.resolve({ disconnected: true });
			}
			return Promise.resolve(undefined);
		});

		const onChange = vi.fn();
		render(<ZosmaStatus authStatus={connectedAuth()} onChange={onChange} />);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /disconnect/i })).toBeTruthy();
		});

		fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));
		await waitFor(() => expect(screen.getByText(/are you sure/i)).toBeTruthy());
		fireEvent.click(screen.getByRole("button", { name: /confirm disconnect/i }));

		await waitFor(() => {
			expect(invokeMock).toHaveBeenCalledWith("disconnect_zosma_auth");
			expect(onChange).toHaveBeenCalled();
		});
	});

	// ── disconnected state ────────────────────────────────────────────────

	it("renders sign-in button when zosmaai-router is NOT in apiKeyProviders", async () => {
		render(<ZosmaStatus authStatus={disconnectedAuth()} onChange={vi.fn()} />);

		expect(screen.getByText(/sign in with zosma/i)).toBeTruthy();
	});

	it("reconnect uses browser flow via start_zosma_auth", async () => {
		invokeMock.mockImplementation((cmd: string, _args?: Record<string, unknown>) => {
			if (cmd === "start_zosma_auth") {
				return Promise.resolve({ authorizationUrl: "https://auth.zosma.ai/authorize?state=..." });
			}
			if (cmd === "open_url") {
				return Promise.resolve(undefined);
			}
			return Promise.resolve(undefined);
		});

		render(<ZosmaStatus authStatus={disconnectedAuth()} onChange={vi.fn()} />);

		fireEvent.click(screen.getByRole("button", { name: /sign in with zosma/i }));

		await waitFor(() => {
			expect(invokeMock).toHaveBeenCalledWith("start_zosma_auth");
			expect(invokeMock).toHaveBeenCalledWith("open_url", {
				url: "https://auth.zosma.ai/authorize?state=...",
			});
		});
	});

	it("reconnect shows waiting state after starting auth", async () => {
		invokeMock.mockImplementation((cmd: string) => {
			if (cmd === "start_zosma_auth") {
				return Promise.resolve({ authorizationUrl: "https://auth.zosma.ai/authorize" });
			}
			if (cmd === "open_url") {
				return Promise.resolve(undefined);
			}
			return Promise.resolve(undefined);
		});

		render(<ZosmaStatus authStatus={disconnectedAuth()} onChange={vi.fn()} />);

		fireEvent.click(screen.getByRole("button", { name: /sign in with zosma/i }));

		await waitFor(() => {
			expect(screen.getByText(/waiting/i)).toBeTruthy();
		});
	});
});
