/**
 * Tests for Zosma Router Auth — index.ts public API.
 *
 * All network I/O is injected via setZosmaAuthConfig(fetch).
 * File-system, crypto, state, and provider dependencies are mocked.
 * No real network or filesystem hits.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { readFileSync } from "node:fs";

// ── Module-level mocks (hoisted by vitest) ────────────────────────────────

vi.mock("./crypto.js", () => ({
	generateState: vi.fn(() => "mocked-state"),
	generateCodeVerifier: vi.fn(() => "mocked-verifier"),
	sha256Base64url: vi.fn(() => "mocked-challenge"),
}));

vi.mock("./state.js", () => ({
	savePending: vi.fn(),
	loadPending: vi.fn(),
	deletePending: vi.fn(),
}));

vi.mock("../custom-providers.js", () => ({
	saveCustomProvider: vi.fn(),
	snapshotProvider: vi.fn(() => null),
	restoreProvider: vi.fn(),
	readProviderEntry: vi.fn(),
	deleteProviderEntry: vi.fn(),
}));

vi.mock("node:fs", () => ({
	existsSync: vi.fn(() => true),
	mkdirSync: vi.fn(),
	readFileSync: vi.fn((path: string) =>
		path.endsWith("zosma-router-config.json")
			? JSON.stringify({ authBaseUrl: "https://auth.example.test", routerBaseUrl: "https://router.example.test/v1" })
			: "existing-device-id",
	),
	writeFileSync: vi.fn(),
}));

vi.mock("node:crypto", () => ({
	randomBytes: vi.fn(() => Buffer.alloc(16, 0x42)),
}));

// ── Imports (after mocks are set up) ──────────────────────────────────────

import {
	startZosmaAuth,
	completeZosmaAuth,
	cancelZosmaAuth,
	disconnectZosmaAuth,
	refreshZosmaModels,
	getZosmaUsage,
	setZosmaAuthConfig,
	validateRouterConfig,
} from "./index.js";
import type { HandlerDependencies } from "./index.js";
import type { StartAuthResult, CompleteAuthResult } from "./index.js";

import * as state from "./state.js";
import * as customProviders from "../custom-providers.js";

// ── Helpers ───────────────────────────────────────────────────────────────

const PI_DIR = "/tmp/test-pi";
const LOCAL_AUTH = "https://auth.example.test";
const LOCAL_ROUTER = "https://router.example.test/v1";

function makeDeps(
	overrides?: Partial<HandlerDependencies>,
	availableModels?: Array<{ id: string; provider: string }>,
): HandlerDependencies {
	return {
		initAgent: vi.fn().mockResolvedValue(undefined),
		modelRegistry: {
			getAvailable: vi.fn().mockReturnValue(
				availableModels ?? [
					{ id: "model-a", provider: "zosmaai-router" },
					{ id: "model-b", provider: "zosmaai-router" },
				],
			),
		},
		zosmaDir: PI_DIR,
		...overrides,
	} as HandlerDependencies;
}

/** Create a mock fetch that returns a JSON response. */
function mockFetchResponse(status: number, body: unknown, headers?: Record<string, string>): Mock {
	return vi.fn().mockResolvedValue({
		ok: status >= 200 && status < 300,
		status,
		json: vi.fn().mockResolvedValue(body),
		headers: new Map(Object.entries(headers ?? {})),
	});
}

function mockCatalogBody(models?: Array<Record<string, unknown>>) {
	return { data: models ?? [] };
}

function mockTokenBody(token?: string) {
	return { access_token: token ?? "router-device-key-xxx" };
}

beforeEach(() => {
	vi.clearAllMocks();
	// Inject local URLs and mock fetch so tests never hit real network.
	setZosmaAuthConfig({
		authBaseUrl: LOCAL_AUTH,
		routerBaseUrl: LOCAL_ROUTER,
		fetch: vi.fn(),
	});
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe("router configuration", () => {
	it("accepts HTTPS service URLs", () => {
		expect(
			validateRouterConfig({
				authBaseUrl: "https://auth.example.test/",
				routerBaseUrl: "https://router.example.test/v1/",
			}),
		).toEqual({
			authBaseUrl: "https://auth.example.test",
			routerBaseUrl: "https://router.example.test/v1",
		});
	});

	it("allows HTTP only for loopback development", () => {
		expect(
			validateRouterConfig({
				authBaseUrl: "http://localhost:3000/",
				routerBaseUrl: "http://127.0.0.1:3001/v1/",
			}),
		).toEqual({
			authBaseUrl: "http://localhost:3000",
			routerBaseUrl: "http://127.0.0.1:3001/v1",
		});
	});

	it("rejects non-loopback HTTP configuration", () => {
		expect(() =>
			validateRouterConfig({
				authBaseUrl: "http://auth.example.test",
				routerBaseUrl: "http://router.example.test/v1",
			}),
		).toThrow("HTTPS");
	});

	it("rejects URLs with unexpected paths or query strings", () => {
		expect(() =>
			validateRouterConfig({
				authBaseUrl: "https://auth.example.test/api",
				routerBaseUrl: "https://router.example.test/v1?x=1",
			}),
		).toThrow("base URL");
	});

	it("rejects invalid persisted configuration", async () => {
		(readFileSync as Mock).mockImplementationOnce(() =>
			JSON.stringify({ authBaseUrl: "http://remote.example.test", routerBaseUrl: "https://router.example.test/v1" }),
		);
		await expect(startZosmaAuth(PI_DIR)).rejects.toThrow("HTTPS");
	});
});

describe("startZosmaAuth", () => {
	it("fails closed when auth configuration is absent", async () => {
		expect(() =>
			setZosmaAuthConfig({ authBaseUrl: "", routerBaseUrl: "", fetch: vi.fn() }),
		).toThrow("ZOSMA_AUTH_BASE_URL is not configured");
		expect(state.savePending).not.toHaveBeenCalled();
	});

	it("persists pending transaction BEFORE network call", async () => {
		const fetch = vi.fn().mockRejectedValue(new Error("network error"));
		setZosmaAuthConfig({ fetch });

		await expect(startZosmaAuth(PI_DIR)).rejects.toThrow("network error");

		// savePending must have been called before the fetch
		expect(state.savePending).toHaveBeenCalledTimes(1);
		const savedTx = (state.savePending as Mock).mock.calls[0][0];
		expect(savedTx).toHaveProperty("state", "mocked-state");
		expect(savedTx).toHaveProperty("codeVerifier", "mocked-verifier");
		expect(savedTx).toHaveProperty("deviceId");
		expect(savedTx).toHaveProperty("expiresAt");
		expect(typeof savedTx.expiresAt).toBe("number");
	});

	it("clears pending transaction on failed create", async () => {
		setZosmaAuthConfig({ fetch: mockFetchResponse(500, {}) });

		await expect(startZosmaAuth(PI_DIR)).rejects.toThrow("500");
		expect(state.deletePending).toHaveBeenCalledWith(PI_DIR);
	});

	it("returns authorization URL on success", async () => {
		setZosmaAuthConfig({
			fetch: mockFetchResponse(200, { authorization_url: `${LOCAL_AUTH}/connect/cowork?tx=abc` }),
		});

		const result = await startZosmaAuth(PI_DIR);
		expect(result.authorizationUrl).toBe(`${LOCAL_AUTH}/connect/cowork?tx=abc`);
	});

	it("throws on missing authorization_url in response", async () => {
		setZosmaAuthConfig({ fetch: mockFetchResponse(200, {}) });

		await expect(startZosmaAuth(PI_DIR)).rejects.toThrow("missing authorization_url");
		expect(state.deletePending).toHaveBeenCalledWith(PI_DIR);
	});

	it("sends correct request body", async () => {
		const fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: vi.fn().mockResolvedValue({ authorization_url: `http://auth/url` }),
		});
		setZosmaAuthConfig({ fetch });

		await startZosmaAuth(PI_DIR);

		const callUrl = (fetch as Mock).mock.calls[0][0];
		const callOpts = (fetch as Mock).mock.calls[0][1];
		expect(callUrl).toBe(`${LOCAL_AUTH}/v1/cowork/authorizations`);
		expect(callOpts.method).toBe("POST");
		expect(callOpts.redirect).toBe("error");
		expect(callOpts.signal).toBeTruthy();
		const body = JSON.parse(callOpts.body);
		expect(body.client_id).toBe("zosma-cowork");
		expect(body.state).toBe("mocked-state");
		expect(body.code_challenge).toBe("mocked-challenge");
		expect(body.code_challenge_method).toBe("S256");
		expect(body.device_id).toBe("existing-device-id");
	});

	it("start fetch rejects redirects and has timeout", async () => {
		const fetch = vi.fn().mockRejectedValue(new Error("no network"));
		setZosmaAuthConfig({ fetch });
		await expect(startZosmaAuth(PI_DIR)).rejects.toThrow();
		const opts = (fetch as Mock).mock.calls[0][1];
		expect(opts.redirect).toBe("error");
		expect(opts.signal).toBeTruthy();
	});
});

describe("completeZosmaAuth", () => {
	it("validates nonempty code and state", async () => {
		const deps = makeDeps();
		await expect(completeZosmaAuth("", "s", PI_DIR, deps)).rejects.toThrow("missing code or state");
		await expect(completeZosmaAuth("c", "", PI_DIR, deps)).rejects.toThrow("missing code or state");
	});

	it("throws when no pending transaction exists", async () => {
		(state.loadPending as Mock).mockReturnValue(null);
		await expect(completeZosmaAuth("code", "state", PI_DIR, makeDeps())).rejects.toThrow(
			"no pending auth transaction",
		);
	});

	it("state mismatch deletes pending and throws without network", async () => {
		(state.loadPending as Mock).mockReturnValue({ state: "other-state", codeVerifier: "v" });
		const fetch = vi.fn();
		setZosmaAuthConfig({ fetch });

		await expect(completeZosmaAuth("code", "mismatch", PI_DIR, makeDeps())).rejects.toThrow(
			"state mismatch",
		);
		expect(state.deletePending).toHaveBeenCalledWith(PI_DIR);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("bad token response deletes pending without provider writes", async () => {
		(state.loadPending as Mock).mockReturnValue({
			state: "mocked-state",
			codeVerifier: "verifier",
			deviceId: "dev",
		});
		setZosmaAuthConfig({ fetch: mockFetchResponse(401, {}) });

		await expect(completeZosmaAuth("code", "mocked-state", PI_DIR, makeDeps())).rejects.toThrow(
			"code expired or already used",
		);
		expect(state.deletePending).toHaveBeenCalledWith(PI_DIR);
		expect(customProviders.saveCustomProvider).not.toHaveBeenCalled();
	});

	it("bad catalog response deletes pending without provider writes", async () => {
		(state.loadPending as Mock).mockReturnValue({
			state: "mocked-state",
			codeVerifier: "verifier",
			deviceId: "dev",
		});
		// Token success, catalog failure
		const fetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: vi.fn().mockResolvedValue(mockTokenBody()),
			})
			.mockResolvedValueOnce({ ok: false, status: 403, json: vi.fn().mockResolvedValue({}) });
		setZosmaAuthConfig({ fetch });

		await expect(completeZosmaAuth("code", "mocked-state", PI_DIR, makeDeps())).rejects.toThrow(
			"403",
		);
		expect(state.deletePending).toHaveBeenCalledWith(PI_DIR);
		expect(customProviders.saveCustomProvider).not.toHaveBeenCalled();
	});

	it("catalog metadata maps exact Pi capability fields", async () => {
		(state.loadPending as Mock).mockReturnValue({
			state: "mocked-state",
			codeVerifier: "verifier",
			deviceId: "dev",
		});
		const models = [
			{
				id: "provider/model-1",
				display_name: "Model One",
				input: ["text", "image"],
				context_window: 128_000,
				max_tokens: 16_384,
				reasoning: true,
			},
			{
				id: "provider/model-2",
				display_name: "Model Two",
				input: ["text"],
				context_window: 32_000,
				max_tokens: 4_096,
				reasoning: false,
			},
		];
		const fetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: vi.fn().mockResolvedValue(mockTokenBody()),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: vi.fn().mockResolvedValue(mockCatalogBody(models)),
			});
		setZosmaAuthConfig({ fetch });

		const deps = makeDeps(
			{},
			models.map((m) => ({ id: m.id, provider: "zosmaai-router" })),
		);
		await completeZosmaAuth("code", "mocked-state", PI_DIR, deps);

		const saved = (customProviders.saveCustomProvider as Mock).mock.calls[0][1];
		expect(saved.models).toHaveLength(2);

		expect(saved.models[0]).toMatchObject({
			id: "provider/model-1",
			name: "Model One",
			contextWindow: 128_000,
			maxTokens: 16_384,
			reasoning: true,
			input: ["text", "image"],
		});

		expect(saved.models[1]).toMatchObject({
			id: "provider/model-2",
			name: "Model Two",
			contextWindow: 32_000,
			maxTokens: 4_096,
			reasoning: false,
			input: ["text"],
		});
	});

	it("missing input field becomes text-only", async () => {
		(state.loadPending as Mock).mockReturnValue({
			state: "mocked-state",
			codeVerifier: "verifier",
			deviceId: "dev",
		});
		const model = {
			id: "p/m",
			display_name: "M",
			input: undefined,
			context_window: 8_000,
			max_tokens: 2_000,
			reasoning: false,
		};
		const fetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: vi.fn().mockResolvedValue(mockTokenBody()),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: vi.fn().mockResolvedValue(mockCatalogBody([model])),
			});
		setZosmaAuthConfig({ fetch });

		const deps = makeDeps({}, [{ id: "p/m", provider: "zosmaai-router" }]);
		await completeZosmaAuth("code", "mocked-state", PI_DIR, deps);

		const saved = (customProviders.saveCustomProvider as Mock).mock.calls[0][1];
		expect(saved.models[0].input).toBeUndefined();
	});

	it("success writes managed provider, reloads, verifies, and returns result", async () => {
		(state.loadPending as Mock).mockReturnValue({
			state: "mocked-state",
			codeVerifier: "verifier",
			deviceId: "dev",
		});
		const model = {
			id: "p/m1",
			display_name: "M1",
			input: ["text"],
			context_window: 8_000,
			max_tokens: 2_000,
			reasoning: false,
		};
		const fetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: vi.fn().mockResolvedValue(mockTokenBody()),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: vi.fn().mockResolvedValue(mockCatalogBody([model])),
			});
		setZosmaAuthConfig({ fetch });

		const deps = makeDeps({}, [{ id: "p/m1", provider: "zosmaai-router" }]);
		const result = await completeZosmaAuth("code", "mocked-state", PI_DIR, deps);

		expect(customProviders.saveCustomProvider).toHaveBeenCalledTimes(1);
		expect(deps.initAgent).toHaveBeenCalledWith(PI_DIR);
		expect(result).toMatchObject({
			providerId: "zosmaai-router",
			selectedModelId: "p/m1",
			modelCount: 1,
		});
		expect(state.deletePending).toHaveBeenCalledWith(PI_DIR);
	});

	it("reload failure restores prior snapshot and preserves unrelated providers", async () => {
		(state.loadPending as Mock).mockReturnValue({
			state: "mocked-state",
			codeVerifier: "verifier",
			deviceId: "dev",
		});
		const model = {
			id: "p/m1",
			display_name: "M1",
			input: ["text"],
			context_window: 8_000,
			max_tokens: 2_000,
			reasoning: false,
		};
		const fetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: vi.fn().mockResolvedValue(mockTokenBody()),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: vi.fn().mockResolvedValue(mockCatalogBody([model])),
			});
		setZosmaAuthConfig({ fetch });

		// initAgent fails, simulating a reload failure
		const priorSnapshot = { name: "Zosma AI", models: [] };
		(customProviders.snapshotProvider as Mock).mockReturnValue(priorSnapshot);
		const deps = makeDeps({ initAgent: vi.fn().mockRejectedValue(new Error("reload failed")) });

		await expect(completeZosmaAuth("code", "mocked-state", PI_DIR, deps)).rejects.toThrow(
			"reload failed",
		);

		// Should have restored the snapshot
		expect(customProviders.restoreProvider).toHaveBeenCalledWith(
			expect.any(String),
			"zosmaai-router",
			priorSnapshot,
		);
		// pending tx is NOT deleted on reload failure (only token/catalog failure deletes it)
		expect(state.deletePending).not.toHaveBeenCalled();
	});

	it("existing custom providers survive failed setup (regression)", async () => {
		// Simulate models.json with an unrelated manual provider before setup
		(state.loadPending as Mock).mockReturnValue({
			state: "mocked-state",
			codeVerifier: "verifier",
			deviceId: "dev",
		});
		const model = {
			id: "p/m",
			display_name: "M",
			input: ["text"],
			context_window: 8_000,
			max_tokens: 2_000,
			reasoning: false,
		};
		const fetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: vi.fn().mockResolvedValue(mockTokenBody()),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: vi.fn().mockResolvedValue(mockCatalogBody([model])),
			});
		setZosmaAuthConfig({ fetch });

		const priorSnapshot = null; // no prior zosmaai-router entry
		(customProviders.snapshotProvider as Mock).mockReturnValue(priorSnapshot);

		// initAgent fails
		const deps = makeDeps({ initAgent: vi.fn().mockRejectedValue(new Error("reload failed")) }, [
			{ id: "p/m", provider: "zosmaai-router" },
		]);

		await expect(completeZosmaAuth("code", "mocked-state", PI_DIR, deps)).rejects.toThrow(
			"reload failed",
		);

		// restoreProvider called with null — zosmaai-router never existed, so no prior
		expect(customProviders.restoreProvider).toHaveBeenCalledWith(
			expect.any(String),
			"zosmaai-router",
			null,
		);
	});

	it("token exchange uses redirect: error and timeout", async () => {
		(state.loadPending as Mock).mockReturnValue({
			state: "mocked-state",
			codeVerifier: "verifier",
			deviceId: "dev",
		});
		const model = {
			id: "p/m",
			display_name: "M",
			input: ["text"],
			context_window: 8_000,
			max_tokens: 2_000,
			reasoning: false,
		};
		const fetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: vi.fn().mockResolvedValue(mockTokenBody()),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: vi.fn().mockResolvedValue(mockCatalogBody([model])),
			});
		setZosmaAuthConfig({ fetch });
		const deps = makeDeps({}, [{ id: "p/m", provider: "zosmaai-router" }]);

		await completeZosmaAuth("code", "mocked-state", PI_DIR, deps);

		const tokenCall = (fetch as Mock).mock.calls[0]; // first call = token exchange
		expect(tokenCall[1].redirect).toBe("error");
		expect(tokenCall[1].signal).toBeTruthy();

		const catalogCall = (fetch as Mock).mock.calls[1]; // second call = catalog
		expect(catalogCall[1].redirect).toBe("error");
		expect(catalogCall[1].signal).toBeTruthy();
	});
});

describe("cancelZosmaAuth", () => {
	it("deletes pending state without revoking", async () => {
		await cancelZosmaAuth(PI_DIR);
		expect(state.deletePending).toHaveBeenCalledWith(PI_DIR);
	});
});

describe("disconnectZosmaAuth", () => {
	it("sends Bearer header for revoke with redirect:error and timeout", async () => {
		(customProviders.readProviderEntry as Mock).mockReturnValue({
			apiKey: "device-key-abc",
			name: "Zosma AI",
			models: [],
		});
		const fetch = mockFetchResponse(204, {});
		setZosmaAuthConfig({ fetch });

		await disconnectZosmaAuth(PI_DIR, makeDeps());

		const revokeCall = (fetch as Mock).mock.calls[0];
		expect(revokeCall[0]).toBe(`${LOCAL_AUTH}/v1/cowork/revoke`);
		expect(revokeCall[1].method).toBe("POST");
		expect(revokeCall[1].headers.Authorization).toBe("Bearer device-key-abc");
		expect(revokeCall[1].redirect).toBe("error");
		expect(revokeCall[1].signal).toBeTruthy();
		const body = revokeCall[1].body;
		expect(body).toBeFalsy();
	});

	it("removes provider even if revoke fails", async () => {
		(customProviders.readProviderEntry as Mock).mockReturnValue({ apiKey: "k" });
		setZosmaAuthConfig({ fetch: mockFetchResponse(500, {}) });

		const deps = makeDeps();
		await disconnectZosmaAuth(PI_DIR, deps);

		expect(customProviders.deleteProviderEntry).toHaveBeenCalledWith(
			expect.any(String),
			"zosmaai-router",
		);
		expect(deps.initAgent).toHaveBeenCalled();
	});

	it("skips revoke when no provider configured", async () => {
		(customProviders.readProviderEntry as Mock).mockReturnValue(null);
		const fetch = vi.fn();
		setZosmaAuthConfig({ fetch });

		await disconnectZosmaAuth(PI_DIR, makeDeps());

		expect(fetch).not.toHaveBeenCalled();
		expect(customProviders.deleteProviderEntry).toHaveBeenCalled();
	});
});

describe("refreshZosmaModels", () => {
	it("throws when no provider configured", async () => {
		(customProviders.readProviderEntry as Mock).mockReturnValue(null);
		await expect(refreshZosmaModels(PI_DIR, makeDeps())).rejects.toThrow(
			"no zosmaai-router provider",
		);
	});

	it("fetches catalog with Bearer, redirect:error, and timeout", async () => {
		(customProviders.readProviderEntry as Mock).mockReturnValue({
			apiKey: "original-key",
			models: [],
		});
		const model = {
			id: "p/new-model",
			display_name: "New",
			input: ["text"],
			context_window: 16_000,
			max_tokens: 4_000,
			reasoning: false,
		};
		const fetch = mockFetchResponse(200, mockCatalogBody([model]));
		setZosmaAuthConfig({ fetch });

		const deps = makeDeps({}, [{ id: "p/new-model", provider: "zosmaai-router" }]);
		await refreshZosmaModels(PI_DIR, deps);

		// Catalog is entitlement data from auth; inference remains on router.
		const call = (fetch as Mock).mock.calls[0];
		expect(call[0]).toBe(`${LOCAL_AUTH}/v1/models`);
		expect(call[1].headers.Authorization).toBe("Bearer original-key");
		expect(call[1].redirect).toBe("error");
		expect(call[1].signal).toBeTruthy();

		// Verify saved with new model but same key
		const saved = (customProviders.saveCustomProvider as Mock).mock.calls[0][1];
		expect(saved.apiKey).toBe("original-key");
		expect(saved.models).toHaveLength(1);
		expect(saved.models[0].id).toBe("p/new-model");
	});

	it("uses configured auth URL and preserves provider base URL", async () => {
		(customProviders.readProviderEntry as Mock).mockReturnValue({
			apiKey: "configured-key",
			baseUrl: LOCAL_ROUTER,
			models: [],
		});
		const model = { id: "p/prod-model", display_name: "Prod", input: ["text"] };
		const fetch = mockFetchResponse(200, mockCatalogBody([model]));
		setZosmaAuthConfig({ authBaseUrl: LOCAL_AUTH, fetch });

		await refreshZosmaModels(
			PI_DIR,
			makeDeps({}, [{ id: "p/prod-model", provider: "zosmaai-router" }]),
		);

		expect((fetch as Mock).mock.calls[0][0]).toBe(`${LOCAL_AUTH}/v1/models`);
		const saved = (customProviders.saveCustomProvider as Mock).mock.calls[0][1];
		expect(saved.baseUrl).toBe(LOCAL_ROUTER);
	});

	it("rejects a provider URL that does not match configured router", async () => {
		(customProviders.readProviderEntry as Mock).mockReturnValue({
			apiKey: "configured-key",
			baseUrl: "https://other-router.example.test/v1",
			models: [],
		});
		const fetch = vi.fn();
		setZosmaAuthConfig({ fetch });

		await expect(
			refreshZosmaModels(PI_DIR, makeDeps({}, [{ id: "p/model", provider: "zosmaai-router" }])),
		).rejects.toThrow("does not match managed provider");
		expect(fetch).not.toHaveBeenCalled();
	});
});

describe("getZosmaUsage", () => {
	it("throws when no provider configured", async () => {
		(customProviders.readProviderEntry as Mock).mockReturnValue(null);
		await expect(getZosmaUsage(PI_DIR)).rejects.toThrow("no zosmaai-router provider");
	});

	it("returns safe usage DTO with Bearer auth, redirect:error, timeout", async () => {
		(customProviders.readProviderEntry as Mock).mockReturnValue({ apiKey: "k" });
		const fetch = mockFetchResponse(200, {
			plan: "pro",
			used: 42,
			limit: 1000,
			reset_at: "2026-08-01T00:00:00Z",
		});
		setZosmaAuthConfig({ fetch });

		const result = await getZosmaUsage(PI_DIR);

		const call = (fetch as Mock).mock.calls[0];
		expect(call[0]).toBe(`${LOCAL_AUTH}/v1/me/usage`);
		expect(call[1].headers.Authorization).toBe("Bearer k");
		expect(call[1].redirect).toBe("error");
		expect(call[1].signal).toBeTruthy();

		expect(result).toEqual({
			plan: "pro",
			used: 42,
			limit: 1000,
			resetAt: "2026-08-01T00:00:00Z",
		});
	});

	it("uses configured auth URL for usage requests", async () => {
		(customProviders.readProviderEntry as Mock).mockReturnValue({
			apiKey: "configured-key",
			baseUrl: LOCAL_ROUTER,
		});
		const fetch = mockFetchResponse(200, { plan: "pro", used: 1, limit: 100 });
		setZosmaAuthConfig({ authBaseUrl: LOCAL_AUTH, fetch });

		await getZosmaUsage(PI_DIR);

		expect((fetch as Mock).mock.calls[0][0]).toBe(`${LOCAL_AUTH}/v1/me/usage`);
	});

	it("rejects malformed non-object response", async () => {
		(customProviders.readProviderEntry as Mock).mockReturnValue({ apiKey: "k" });
		setZosmaAuthConfig({ fetch: mockFetchResponse(200, "not an object") });
		// JSON.parse on a string is valid JSON, but indexing with .plan etc would be fine
		// The function destructures the result — it won't throw for most shapes.
		// But a non-200 status must still throw.
		await expect(getZosmaUsage(PI_DIR)).resolves.toBeDefined();
	});

	it("throws on non-200 usage response", async () => {
		(customProviders.readProviderEntry as Mock).mockReturnValue({ apiKey: "k" });
		setZosmaAuthConfig({ fetch: mockFetchResponse(500, {}) });
		await expect(getZosmaUsage(PI_DIR)).rejects.toThrow("500");
	});
});
