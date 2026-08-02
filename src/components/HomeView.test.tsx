/**
 * Tests for HomeView — onboarding API-key validation + live probe.
 *
 * Tests:
 *   1. Tier 1 format check: wrong provider key → hint shown + Connect NOT disabled
 *   2. Tier 1 format check: right provider key → hint cleared
 *   3. Live probe: validate_provider_key called BEFORE onComplete
 *   4. Live probe: invalid key → error shown, onComplete NOT called
 *   5. Live probe: valid key → onComplete called
 *   6. Live probe: no probe registered → onComplete called with warning
 *   7. Live probe: probe throws (offline) → onComplete called with warning
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeView } from "./HomeView";

// ── Mocks ────────────────────────────────────────────────────────────────

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
	invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Mock deep-link for useZosmaAuth
const mockGetCurrent = vi.fn().mockResolvedValue(null); // string[] | null
const mockOnOpenUrl = vi.fn().mockResolvedValue(vi.fn());
vi.mock("@tauri-apps/plugin-deep-link", () => ({
	getCurrent: (...args: unknown[]) => mockGetCurrent(...args),
	onOpenUrl: (...args: unknown[]) => mockOnOpenUrl(...args),
}));

// ── Default sidecar response factory ────────────────────────────────────

interface AuthStatus {
	providers: Array<{ id: string; type: string }>;
	supported: string[];
	apiKeyProviders: Array<{ id: string; displayName: string }>;
}

function makeAuthStatus(overrides?: Partial<AuthStatus>): AuthStatus {
	const apiKeyProviders = [
		{ id: "openrouter", displayName: "OpenRouter" },
		{ id: "anthropic", displayName: "Anthropic" },
		{ id: "openai", displayName: "OpenAI" },
	];
	return {
		providers: [],
		supported: ["anthropic", "github-copilot", "openai-codex"],
		apiKeyProviders,
		...overrides,
	};
}

function configureSidecar(
	authStatus?: AuthStatus,
	opts: {
		validateResult?: Record<string, unknown>;
		validateDelay?: number;
		validateError?: boolean;
	} = {},
) {
	const { validateResult, validateDelay = 0, validateError } = opts;

	mockInvoke.mockImplementation((cmd: string, _args?: Record<string, unknown>) => {
		if (cmd === "get_auth_status") return Promise.resolve(authStatus ?? makeAuthStatus());
		if (cmd === "validate_provider_key") {
			if (validateError) return Promise.reject(new Error("offline"));
			const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
			return validateDelay
				? delay(validateDelay).then(() => validateResult ?? { ok: true })
				: Promise.resolve(validateResult ?? { ok: true });
		}
		return Promise.resolve(null);
	});
}

// ── Helpers ──────────────────────────────────────────────────────────────

async function advanceToConnectScreen() {
	const cta = screen.queryByRole("button", { name: /connect your ai/i });
	if (cta) {
		await act(async () => {
			fireEvent.click(cta);
		});
	}
	const moreWays = screen.getByRole("button", { name: /more ways to connect/i });
	await act(async () => {
		fireEvent.click(moreWays);
	});
}

async function typeKey(key: string) {
	const input = screen.getByPlaceholderText(/sk-…/i);
	await act(async () => {
		fireEvent.change(input, { target: { value: key } });
	});
}

async function clickConnect() {
	const btn = screen.getByRole("button", { name: /^connect$/i });
	await act(async () => {
		fireEvent.click(btn);
	});
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("HomeView — Tier 1 format check", () => {
	beforeEach(() => {
		configureSidecar();
	});
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("shows a format hint when a wrong-provider key is pasted", async () => {
		render(<HomeView onComplete={vi.fn()} />);
		await advanceToConnectScreen();
		await typeKey("sk-ant-api03-0123456789abcdef");

		expect(screen.getByText(/doesn't look like.*[Oo]pen[Rr]outer/i)).toBeInTheDocument();
	});

	it("clears the format hint when the key is corrected", async () => {
		render(<HomeView onComplete={vi.fn()} />);
		await advanceToConnectScreen();
		await typeKey("sk-ant-api03-0123456789abcdef");
		expect(screen.getByText(/doesn't look like/i)).toBeInTheDocument();

		await typeKey("sk-or-v1-0123456789abcdef0123456789");
		expect(screen.queryByText(/doesn't look like/i)).not.toBeInTheDocument();
	});

	it("shows format hint but does not disable Connect", async () => {
		render(<HomeView onComplete={vi.fn()} />);
		await advanceToConnectScreen();
		await typeKey("sk-ant-api03-0123456789abcdef");

		expect(screen.getByText(/doesn't look like/i)).toBeInTheDocument();
		expect(screen.getByText(/you can still connect/i)).toBeInTheDocument();

		const connectButton = screen.getByRole("button", { name: /^connect$/i });
		expect(connectButton).not.toBeDisabled();
	});

	it("changes input border to warning color when format is wrong", async () => {
		render(<HomeView onComplete={vi.fn()} />);
		await advanceToConnectScreen();
		await typeKey("sk-ant-api03-0123456789abcdef");

		const input = screen.getByPlaceholderText(/sk-…/i);
		expect(input.style.borderColor).toBe("hsl(var(--warning))");
	});

	it("changes input border to destructive when error is set", async () => {
		configureSidecar(makeAuthStatus(), {
			validateResult: {
				ok: false,
				probe: { ok: false, status: 401, message: "Invalid API key" },
			},
		});
		const onComplete = vi.fn();
		render(<HomeView onComplete={onComplete} />);
		await advanceToConnectScreen();
		await typeKey("sk-or-v1-0123456789abcdef0123456789");
		await clickConnect();

		await waitFor(() => {
			expect(screen.getByText(/key invalid/i)).toBeInTheDocument();
		});

		const input = screen.getByPlaceholderText(/sk-…/i);
		expect(input.style.borderColor).toBe("hsl(var(--destructive))");
	});
});

describe("HomeView — live probe", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("calls validate_provider_key BEFORE onComplete", async () => {
		configureSidecar(makeAuthStatus(), {
			validateResult: { ok: true, probe: { ok: true } },
		});
		const onComplete = vi.fn().mockResolvedValue(undefined);
		render(<HomeView onComplete={onComplete} />);
		await advanceToConnectScreen();
		await typeKey("sk-or-v1-0123456789abcdef0123456789");
		await clickConnect();

		await waitFor(() => {
			expect(mockInvoke).toHaveBeenCalledWith("validate_provider_key", {
				provider: "openrouter",
				key: "sk-or-v1-0123456789abcdef0123456789",
			});
		});

		await waitFor(() => {
			expect(onComplete).toHaveBeenCalledWith("openrouter", "sk-or-v1-0123456789abcdef0123456789");
		});
	});

	it("does NOT call onComplete when probe says key is invalid", async () => {
		configureSidecar(makeAuthStatus(), {
			validateResult: {
				ok: false,
				probe: { ok: false, status: 401, message: "Invalid API key" },
			},
		});
		const onComplete = vi.fn().mockResolvedValue(undefined);
		render(<HomeView onComplete={onComplete} />);
		await advanceToConnectScreen();
		await typeKey("sk-or-v1-0123456789abcdef0123456789");
		await clickConnect();

		await waitFor(() => {
			expect(screen.getByText(/key invalid/i)).toBeInTheDocument();
		});

		expect(onComplete).not.toHaveBeenCalled();
	});

	it("shows 'Checking key…' while probe is in flight", async () => {
		configureSidecar(makeAuthStatus(), {
			validateResult: { ok: true, probe: { ok: true } },
			validateDelay: 200,
		});
		const onComplete = vi.fn().mockResolvedValue(undefined);
		render(<HomeView onComplete={onComplete} />);
		await advanceToConnectScreen();
		await typeKey("sk-or-v1-0123456789abcdef0123456789");
		await clickConnect();

		expect(screen.getByText(/checking key/i)).toBeInTheDocument();

		await waitFor(() => {
			expect(onComplete).toHaveBeenCalled();
		});
	});

	it("calls onComplete when no probe is registered for provider", async () => {
		configureSidecar(makeAuthStatus(), {
			validateResult: { ok: true }, // no `probe` field
		});
		const onComplete = vi.fn().mockResolvedValue(undefined);
		render(<HomeView onComplete={onComplete} />);
		await advanceToConnectScreen();
		await typeKey("sk-or-v1-0123456789abcdef0123456789");
		await clickConnect();

		await waitFor(() => {
			expect(onComplete).toHaveBeenCalledWith("openrouter", "sk-or-v1-0123456789abcdef0123456789");
		});

		expect(screen.getByText(/couldn't auto-verify/i)).toBeInTheDocument();
	});

	it("calls onComplete when probe throws (offline / sidecar error)", async () => {
		configureSidecar(makeAuthStatus(), {
			validateError: true,
		});
		const onComplete = vi.fn().mockResolvedValue(undefined);
		render(<HomeView onComplete={onComplete} />);
		await advanceToConnectScreen();
		await typeKey("sk-or-v1-0123456789abcdef0123456789");
		await clickConnect();

		await waitFor(() => {
			expect(onComplete).toHaveBeenCalledWith("openrouter", "sk-or-v1-0123456789abcdef0123456789");
		});

		expect(screen.getByText(/couldn't verify key.*offline/i)).toBeInTheDocument();
	});

	it("ALLOWS onComplete when sidecar format check fails (warning only, not blocking)", async () => {
		configureSidecar(makeAuthStatus(), {
			validateResult: {
				ok: false,
				format: { ok: false, hint: "This doesn't look like an OpenRouter key." },
				// probe is undefined when format fails
			},
		});
		const onComplete = vi.fn().mockResolvedValue(undefined);
		render(<HomeView onComplete={onComplete} />);
		await advanceToConnectScreen();
		await typeKey("sk-ant-api03-0123456789abcdef");
		await clickConnect();

		await waitFor(() => {
			expect(onComplete).toHaveBeenCalledWith("openrouter", "sk-ant-api03-0123456789abcdef");
		});

		expect(screen.getByText(/key format doesn't match typical pattern/i)).toBeInTheDocument();
	});

	it("BLOCKS onComplete when live probe fails (ok: false with probe)", async () => {
		configureSidecar(makeAuthStatus(), {
			validateResult: {
				ok: false,
				format: { ok: true },
				probe: { ok: false, status: 401, message: "Invalid API key" },
			},
		});
		const onComplete = vi.fn().mockResolvedValue(undefined);
		render(<HomeView onComplete={onComplete} />);
		await advanceToConnectScreen();
		await typeKey("sk-or-v1-0123456789abcdef0123456789");
		await clickConnect();

		await waitFor(() => {
			expect(screen.getByText(/key invalid/i)).toBeInTheDocument();
		});

		expect(onComplete).not.toHaveBeenCalled();
	});

	it("ALLOWS onComplete when frontend format hint is present but sidecar approves", async () => {
		configureSidecar(makeAuthStatus(), {
			validateResult: { ok: true, probe: { ok: true } },
		});
		const onComplete = vi.fn().mockResolvedValue(undefined);
		render(<HomeView onComplete={onComplete} />);
		await advanceToConnectScreen();
		await typeKey("totally-wrong-format");
		await clickConnect();

		await waitFor(() => {
			expect(onComplete).toHaveBeenCalledWith("openrouter", "totally-wrong-format");
		});
	});
});

// ── Zosma Router Auth card ─────────────────────────────────────────────

describe("HomeView — Zosma auth card", () => {
	beforeEach(() => {
		configureSidecar();
		process.env.VITE_ZOSMA_AUTH_ENABLED = "true";
	});

	afterEach(() => {
		vi.clearAllMocks();
		process.env.VITE_ZOSMA_AUTH_ENABLED = undefined;
	});

	it("initialStep=connect skips splash and collapses alternatives", () => {
		render(<HomeView initialStep="connect" onComplete={vi.fn()} />);

		expect(screen.getByText(/continue with zosma/i)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /more ways to connect/i })).toHaveAttribute(
			"aria-expanded",
			"false",
		);
		expect(screen.queryByText(/^api key$/i)).not.toBeInTheDocument();
	});

	it("splash has no connect CTA and transitions to login", async () => {
		vi.useFakeTimers();
		render(<HomeView initialStep="splash" onComplete={vi.fn()} />);

		expect(screen.queryByRole("button", { name: /connect your ai/i })).not.toBeInTheDocument();
		await act(async () => {
			vi.advanceTimersByTime(1400);
		});
		expect(screen.getByText(/continue with zosma/i)).toBeInTheDocument();
		vi.useRealTimers();
	});

	it("expands existing provider journeys without hiding Zosma", async () => {
		render(<HomeView initialStep="connect" onComplete={vi.fn()} />);
		fireEvent.click(screen.getByRole("button", { name: /more ways to connect/i }));

		expect(screen.getByText(/continue with zosma/i)).toBeInTheDocument();
		expect(screen.getByText(/^api key$/i)).toBeInTheDocument();
		expect(screen.getByText(/claude pro\/max/i)).toBeInTheDocument();
		expect(screen.getByText(/chatgpt/i)).toBeInTheDocument();
		expect(screen.getByText(/github copilot/i)).toBeInTheDocument();
	});

	it("renders 'Continue with Zosma' card on connect screen", async () => {
		render(<HomeView onComplete={vi.fn()} />);
		await advanceToConnectScreen();

		expect(screen.getByText(/continue with zosma/i)).toBeInTheDocument();
		expect(screen.getByText(/recommended/i)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /continue with google/i })).toBeInTheDocument();
	});

	it("card shows before API key section (renders higher in DOM)", async () => {
		render(<HomeView onComplete={vi.fn()} />);
		await advanceToConnectScreen();

		const zosmaCard = screen.getByText(/continue with zosma/i).closest(".border");
		const apiKeyCard = screen.getByText(/api key/i).closest(".border");

		expect(zosmaCard).toBeTruthy();
		expect(apiKeyCard).toBeTruthy();

		// Zosma card should appear before API key card in DOM order
		if (zosmaCard && apiKeyCard) {
			const allCards = screen.getAllByText(/continue with zosma|api key/i);
			expect(allCards[0].textContent).toMatch(/zosma/i);
		}
	});

	it("Continue with Google button starts auth flow and shows waiting state", async () => {
		mockInvoke.mockImplementation((cmd: string) => {
			if (cmd === "start_zosma_auth") {
				return Promise.resolve({
					authorizationUrl: "https://auth.zosma.ai/connect/cowork?transaction=t1",
				});
			}
			if (cmd === "open_url") return Promise.resolve(null);
			if (cmd === "get_auth_status") {
				return Promise.resolve({
					providers: [],
					supported: [],
					apiKeyProviders: [],
				});
			}
			return Promise.reject(new Error(`unexpected: ${cmd}`));
		});

		render(<HomeView onComplete={vi.fn()} />);
		await advanceToConnectScreen();

		const googleBtn = screen.getByRole("button", { name: /continue with google/i });
		await act(async () => {
			fireEvent.click(googleBtn);
		});

		expect(mockInvoke).toHaveBeenCalledWith("start_zosma_auth");
		expect(mockInvoke).toHaveBeenCalledWith(
			"open_url",
			expect.objectContaining({ url: expect.stringContaining("auth.zosma.ai") }),
		);

		await waitFor(() => {
			expect(screen.getByText(/complete sign-in/i)).toBeInTheDocument();
		});
	});

	it("shows Cancel button when waiting for browser", async () => {
		mockInvoke.mockImplementation((cmd: string) => {
			if (cmd === "start_zosma_auth") {
				return Promise.resolve({
					authorizationUrl: "https://auth.zosma.ai/connect/cowork?transaction=t1",
				});
			}
			if (cmd === "open_url") return Promise.resolve(null);
			if (cmd === "get_auth_status") {
				return Promise.resolve({
					providers: [],
					supported: [],
					apiKeyProviders: [],
				});
			}
			return Promise.reject(new Error(`unexpected: ${cmd}`));
		});

		render(<HomeView onComplete={vi.fn()} />);
		await advanceToConnectScreen();

		const googleBtn = screen.getByRole("button", { name: /continue with google/i });
		await act(async () => {
			fireEvent.click(googleBtn);
		});

		await waitFor(() => {
			expect(screen.getByText(/complete sign-in/i)).toBeInTheDocument();
		});

		const cancelBtn = screen.getByRole("button", { name: /cancel/i });
		expect(cancelBtn).toBeInTheDocument();

		// Clicking Cancel resets to idle
		await act(async () => {
			fireEvent.click(cancelBtn);
		});

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /continue with google/i })).toBeInTheDocument();
		});
	});

	it("shows error state with Retry when auth fails", async () => {
		mockInvoke.mockImplementation((cmd: string) => {
			if (cmd === "start_zosma_auth") {
				return Promise.reject(new Error("sidecar not ready"));
			}
			if (cmd === "get_auth_status") {
				return Promise.resolve({
					providers: [],
					supported: [],
					apiKeyProviders: [],
				});
			}
			return Promise.reject(new Error(`unexpected: ${cmd}`));
		});

		render(<HomeView onComplete={vi.fn()} />);
		await advanceToConnectScreen();

		const googleBtn = screen.getByRole("button", { name: /continue with google/i });
		await act(async () => {
			fireEvent.click(googleBtn);
		});

		await waitFor(() => {
			expect(screen.getByText(/retry/i)).toBeInTheDocument();
		});

		// Error message should be user-safe, not raw backend text
		expect(screen.getByText(/try again|restart/i)).toBeInTheDocument();
	});
});
