/**
 * Zosma Router Auth — Public API.
 *
 * startZosmaAuth: generate PKCE state, save pending tx, get browser URL.
 * completeZosmaAuth: exchange code, fetch catalog, atomic save + reload + verify.
 * disconnectZosmaAuth: revoke server-side, remove local provider, reload.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import {
	deleteProviderEntry,
	readProviderEntry,
	restoreProvider,
	saveCustomProvider,
	snapshotProvider,
} from "../custom-providers.js";
import { logWarn } from "../protocol.js";
import { generateCodeVerifier, generateState, sha256Base64url } from "./crypto.js";
import { deletePending, loadPending, savePending } from "./state.js";

// Config comes only from process env, build-time replacement, or explicit
// runtime configuration. Unreplaced slots stay empty so missing configuration
// fails closed instead of selecting an environment.
const BAKED_AUTH_BASE_URL = "__ZOSMA_AUTH_BASE_URL__";
const BAKED_ROUTER_BASE_URL = "__ZOSMA_ROUTER_BASE_URL__";
const unbaked = (value: string): string => (value.startsWith("__ZOSMA_") ? "" : value.trim());
const bakedAuthBaseUrl = unbaked(BAKED_AUTH_BASE_URL);
const bakedRouterBaseUrl = unbaked(BAKED_ROUTER_BASE_URL);
const buildConfigLocked = Boolean(bakedAuthBaseUrl && bakedRouterBaseUrl);
let authBaseUrl = bakedAuthBaseUrl || process.env.ZOSMA_AUTH_BASE_URL?.trim() || "";
let routerBaseUrl = bakedRouterBaseUrl || process.env.ZOSMA_ROUTER_BASE_URL?.trim() || "";
let fetchImpl: typeof globalThis.fetch = globalThis.fetch;
const DEVICE_ID_FILE = "zosma-device-id.txt";
const ROUTER_CONFIG_FILE = "zosma-router-config.json";
const TIMEOUT_MS = 10_000;

/**
 * Override base URLs and fetch implementation for testing.
 * Pass undefined to keep current value.
 */
/**
 * Load router config from piDir if it exists.
 * Called at the start of each zosma-auth operation so file-based config
 * persists across sidecar restarts.
 */
function loadRouterConfig(piDir: string): void {
	if (buildConfigLocked) return;
	const file = join(piDir, ROUTER_CONFIG_FILE);
	if (!existsSync(file)) return;

	const raw = readFileSync(file, "utf-8");
	let parsed: { authBaseUrl?: string; routerBaseUrl?: string };
	try {
		parsed = JSON.parse(raw) as { authBaseUrl?: string; routerBaseUrl?: string };
	} catch {
		throw new Error("persisted router configuration is invalid JSON");
	}

	const config = validateRouterConfig({
		authBaseUrl: process.env.ZOSMA_AUTH_BASE_URL?.trim() || parsed.authBaseUrl || authBaseUrl,
		routerBaseUrl: process.env.ZOSMA_ROUTER_BASE_URL?.trim() || parsed.routerBaseUrl || routerBaseUrl,
	});
	if (!process.env.ZOSMA_AUTH_BASE_URL) authBaseUrl = config.authBaseUrl;
	if (!process.env.ZOSMA_ROUTER_BASE_URL) routerBaseUrl = config.routerBaseUrl;
}

/**
 * Save router config to piDir so it persists across sidecar restarts.
 */
export function saveRouterConfig(
	piDir: string,
	config: { authBaseUrl: string; routerBaseUrl: string },
): void {
	const validated = validateRouterConfig(config);
	if (
		buildConfigLocked &&
		(validated.authBaseUrl !== bakedAuthBaseUrl || validated.routerBaseUrl !== bakedRouterBaseUrl)
	) {
		throw new Error("packaged router configuration cannot be overridden");
	}
	const file = join(piDir, ROUTER_CONFIG_FILE);
	mkdirSync(piDir, { recursive: true });
	writeFileSync(file, JSON.stringify(validated, null, 2), "utf-8");
}

/**
 * Get current router config values.
 */
export function getRouterConfig(): { authBaseUrl: string; routerBaseUrl: string } {
	return { authBaseUrl, routerBaseUrl };
}

export function setZosmaAuthConfig(config: {
	authBaseUrl?: string;
	routerBaseUrl?: string;
	fetch?: typeof globalThis.fetch;
}): void {
	if (config.authBaseUrl !== undefined || config.routerBaseUrl !== undefined) {
		const validated = validateRouterConfig({
			authBaseUrl: config.authBaseUrl ?? authBaseUrl,
			routerBaseUrl: config.routerBaseUrl ?? routerBaseUrl,
		});
		if (
			buildConfigLocked &&
			(validated.authBaseUrl !== bakedAuthBaseUrl || validated.routerBaseUrl !== bakedRouterBaseUrl)
		) {
			throw new Error("packaged router configuration cannot be overridden");
		}
		authBaseUrl = validated.authBaseUrl;
		routerBaseUrl = validated.routerBaseUrl;
	}
	if (config.fetch !== undefined) fetchImpl = config.fetch;
}

function isLoopbackHost(hostname: string): boolean {
	return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function validateBaseUrl(name: string, value: string, pathname: string): string {
	if (!value.trim()) throw new Error(`${name} is not configured`);
	const normalized = value.trim().replace(/\/+$/, "");
	let url: URL;
	try {
		url = new URL(normalized);
	} catch {
		throw new Error(`${name} must be a valid URL`);
	}
	const local = url.protocol === "http:" && isLoopbackHost(url.hostname);
	if (url.protocol !== "https:" && !local) {
		throw new Error(`${name} must use HTTPS (HTTP is allowed only for localhost development)`);
	}
	if (url.pathname !== pathname || url.search || url.hash || url.username || url.password) {
		throw new Error(`${name} must be a base URL with path ${pathname}`);
	}
	return url.toString().replace(/\/+$/, "");
}

export function validateRouterConfig(config: {
	authBaseUrl: string;
	routerBaseUrl: string;
}): { authBaseUrl: string; routerBaseUrl: string } {
	const auth = validateBaseUrl("ZOSMA_AUTH_BASE_URL", config.authBaseUrl, "/");
	const router = validateBaseUrl("ZOSMA_ROUTER_BASE_URL", config.routerBaseUrl, "/v1");
	const authUrl = new URL(auth);
	const routerUrl = new URL(router);
	if (authUrl.protocol !== routerUrl.protocol) {
		throw new Error("authBaseUrl and routerBaseUrl must use the same protocol");
	}
	if (authUrl.protocol === "http:" && (!isLoopbackHost(authUrl.hostname) || !isLoopbackHost(routerUrl.hostname))) {
		throw new Error("HTTP router configuration is allowed only for localhost development");
	}
	return { authBaseUrl: auth, routerBaseUrl: router };
}

function currentConfig(): { authBaseUrl: string; routerBaseUrl: string } {
	return validateRouterConfig({ authBaseUrl, routerBaseUrl });
}

/**
 * Use explicitly configured auth URL for managed providers.
 * Reject mismatched router configuration instead of guessing an environment.
 */
function authBaseForProvider(provider: Record<string, unknown>): string {
	const config = currentConfig();
	const providerBaseUrl = typeof provider.baseUrl === "string" ? provider.baseUrl.trim().replace(/\/+$/, "") : "";
	if (providerBaseUrl && providerBaseUrl !== config.routerBaseUrl) {
		throw new Error("configured router URL does not match managed provider");
	}
	return config.authBaseUrl;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface StartAuthResult {
	authorizationUrl: string;
}

export interface CompleteAuthResult {
	providerId: string;
	selectedModelId: string;
	modelCount: number;
}

export interface HandlerDependencies {
	initAgent: (zosmaDir: string, workspace?: string) => Promise<void>;
	modelRegistry: {
		getAvailable(): Array<{ id: string; provider: string }>;
	};
	zosmaDir: string;
}

type ModelInput = "text" | "image";

interface MappedModel {
	id: string;
	name: string;
	contextWindow?: number;
	maxTokens?: number;
	reasoning: boolean;
	input?: ModelInput[];
}

// ── Device ID ──────────────────────────────────────────────────────────────

/**
 * Load or generate a stable device ID. Persists to `~/.pi/agent/zosma-device-id.txt`.
 */
function loadDeviceId(piDir: string): string {
	const path = join(piDir, DEVICE_ID_FILE);
	try {
		if (existsSync(path)) {
			const existing = readFileSync(path, "utf-8").trim();
			if (existing) return existing;
		}
	} catch {
		// File missing — generate new one below.
	}
	const id = `cowork-${randomBytes(16).toString("hex")}`;
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, id, { mode: 0o600 });
	return id;
}

// ── Model Mapping ──────────────────────────────────────────────────────────

/**
 * Map router model row input capabilities to Pi's `input` shape.
 */
function mapInputCapability(row: Record<string, unknown>): ModelInput[] | undefined {
	if (Array.isArray(row.input)) {
		const filtered = row.input.filter(
			(v: unknown): v is ModelInput => v === "text" || v === "image",
		);
		if (filtered.length > 0) return filtered;
	}
	if (Array.isArray(row.input_modalities)) {
		const hasImage = row.input_modalities.some(
			(m: unknown) =>
				typeof m === "string" && (m === "image" || m === "vision" || m === "image_url"),
		);
		return hasImage ? ["text", "image"] : ["text"];
	}
	return undefined;
}

// ── Public Functions ───────────────────────────────────────────────────────

/**
 * Start the Zosma Router auth flow.
 *
 * 1. Generate state + PKCE code_verifier + S256 challenge
 * 2. Load/generate device ID
 * 3. Save pending transaction BEFORE network call
 * 4. POST to configured auth service to create server-side transaction
 * 5. Return authorizationUrl for system browser
 */
export async function startZosmaAuth(piDir: string): Promise<StartAuthResult> {
	loadRouterConfig(piDir);
	const configuredAuthBaseUrl = currentConfig().authBaseUrl;
	const state = generateState();
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = sha256Base64url(codeVerifier);
	const deviceId = loadDeviceId(piDir);

	// Persist pending transaction BEFORE network call so crash at any point
	// still has recoverable state.
	savePending({ state, codeVerifier, deviceId, expiresAt: Date.now() + 10 * 60 * 1000 }, piDir);

	const res = await fetchImpl(`${configuredAuthBaseUrl}/v1/cowork/authorizations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			client_id: "zosma-cowork",
			state,
			code_challenge: codeChallenge,
			code_challenge_method: "S256",
			device_id: deviceId,
		}),
		redirect: "error",
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});

	if (!res.ok) {
		deletePending(piDir);
		throw new Error(`Auth server returned ${res.status}`);
	}

	const body = (await res.json()) as { authorization_url?: string };
	if (!body.authorization_url) {
		deletePending(piDir);
		throw new Error("Auth server returned missing authorization_url");
	}
	return { authorizationUrl: body.authorization_url };
}

/**
 * Complete the Zosma Router auth flow after browser returns code.
 *
 * 1. Validate inputs
 * 2. Load pending tx, verify state match
 * 3. Exchange code + PKCE verifier for router device key
 * 4. Fetch authenticated model catalog
 * 5. Map to Pi model shape
 * 6. Snapshot existing provider
 * 7. Atomic save via saveCustomProvider
 * 8. Reload Pi registry via deps.initAgent
 * 9. Verify models appear in registry
 * 10. On failure → restore snapshot + re-initAgent + throw
 * 11. Delete pending tx
 * 12. Return result
 */
export async function completeZosmaAuth(
	code: string,
	state: string,
	piDir: string,
	deps: HandlerDependencies,
): Promise<CompleteAuthResult> {
	loadRouterConfig(piDir);
	const config = currentConfig();
	const configuredAuthBaseUrl = config.authBaseUrl;

	// 1. Validate inputs
	if (!code || !state) {
		throw new Error("missing code or state");
	}

	// 2. Load pending transaction
	const tx = loadPending(piDir);
	if (!tx) {
		throw new Error("no pending auth transaction (expired or never started)");
	}
	if (tx.state !== state) {
		deletePending(piDir);
		throw new Error("state mismatch — possible CSRF");
	}

	// 3. Exchange code + PKCE verifier for router device key
	const tokenRes = await fetchImpl(`${configuredAuthBaseUrl}/v1/cowork/token`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			client_id: "zosma-cowork",
			code,
			code_verifier: tx.codeVerifier,
			device_id: tx.deviceId,
		}),
		redirect: "error",
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});

	if (!tokenRes.ok) {
		deletePending(piDir);
		const msg =
			tokenRes.status === 401
				? "code expired or already used"
				: `token exchange returned ${tokenRes.status}`;
		throw new Error(msg);
	}

	const tokenBody = (await tokenRes.json()) as { access_token?: string };
	const routerKey = tokenBody.access_token;
	if (!routerKey) {
		deletePending(piDir);
		throw new Error("token response missing access_token");
	}

	// 4. Fetch authenticated entitlement catalog; inference stays on routerBaseUrl.
	const modelsRes = await fetchImpl(`${configuredAuthBaseUrl}/v1/models`, {
		headers: { Authorization: `Bearer ${routerKey}` },
		redirect: "error",
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});

	if (!modelsRes.ok) {
		deletePending(piDir);
		throw new Error(`model catalog returned ${modelsRes.status}`);
	}

	const catalogBody = (await modelsRes.json()) as { data?: unknown[] };
	const rows = (catalogBody.data ?? []) as Array<Record<string, unknown>>;

	if (rows.length === 0) {
		deletePending(piDir);
		throw new Error("no models entitled for this account");
	}

	// 5. Map to Pi model shape
	const models: MappedModel[] = rows.map((r) => ({
		id: String(r.id),
		name: r.display_name ? String(r.display_name) : String(r.id),
		contextWindow:
			typeof r.context_window === "number"
				? r.context_window
				: typeof r.contextWindow === "number"
					? r.contextWindow
					: undefined,
		maxTokens:
			typeof r.max_tokens === "number"
				? r.max_tokens
				: typeof r.maxTokens === "number"
					? r.maxTokens
					: undefined,
		reasoning: Boolean(r.reasoning),
		input: mapInputCapability(r),
	}));

	// 6. Snapshot existing provider
	const modelsPath = join(piDir, "models.json");
	const prior = snapshotProvider(modelsPath, "zosmaai-router");

	try {
		// 7. Atomic save
		saveCustomProvider(modelsPath, {
			id: "zosmaai-router",
			name: "Zosma AI",
			baseUrl: config.routerBaseUrl,
			apiKey: routerKey,
			models,
		});

		// 8. Reload Pi registry
		await deps.initAgent(deps.zosmaDir);

		// 9. Verify models appear in registry
		const available = deps.modelRegistry.getAvailable();
		const expectedIds = new Set(models.map((m) => m.id));
		const registeredIds = new Set(
			available.filter((m) => m.provider === "zosmaai-router").map((m) => m.id),
		);

		for (const id of expectedIds) {
			if (!registeredIds.has(id)) {
				throw new Error(`model ${id} not found in registry after reload`);
			}
		}
	} catch (err) {
		// 10. Rollback on failure
		restoreProvider(modelsPath, "zosmaai-router", prior);
		try {
			await deps.initAgent(deps.zosmaDir);
		} catch {
			// Re-init after rollback failed — leave it, user can retry.
		}
		throw err;
	}

	// 11. Clean up pending tx
	deletePending(piDir);

	// 12. Return result — select first model (spec says first model for now)
	const selectedModel = models[0];
	return {
		providerId: "zosmaai-router",
		selectedModelId: selectedModel.id,
		modelCount: models.length,
	};
}

/**
 * Disconnect Zosma Router auth.
 *
 * 1. Revoke server-side (best-effort — proceed on failure)
 * 2. Delete local provider entry
 * 3. Reload Pi registry
 */
export async function disconnectZosmaAuth(piDir: string, deps: HandlerDependencies): Promise<void> {
	loadRouterConfig(piDir);
	const modelsPath = join(piDir, "models.json");
	const provider = readProviderEntry(modelsPath, "zosmaai-router");
	const providerAuthBaseUrl = provider ? authBaseForProvider(provider) : "";

	// 1. Server-side revoke (best-effort) — uses Bearer header per frozen contract
	if (provider?.apiKey) {
		try {
			const revokeKey =
				typeof provider.apiKey === "string" ? provider.apiKey : String(provider.apiKey);
			const res = await fetchImpl(`${providerAuthBaseUrl}/v1/cowork/revoke`, {
				method: "POST",
				headers: { Authorization: `Bearer ${revokeKey}` },
				redirect: "error",
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
			if (!res.ok) {
				logWarn("server revoke returned %s; proceeding locally", res.status);
			}
		} catch {
			logWarn("server revoke failed; proceeding locally");
		}
	}

	// 2. Delete local provider
	deleteProviderEntry(modelsPath, "zosmaai-router");

	// 3. Reload Pi registry
	await deps.initAgent(deps.zosmaDir);
}

/**
 * Cancel an in-progress Zosma auth flow.
 *
 * Deletes the pending PKCE transaction only. Never revokes or modifies
 * an existing configured provider.
 */
export async function cancelZosmaAuth(piDir: string): Promise<void> {
	deletePending(piDir);
}

/**
 * Refresh Zosma Router models without rotating the device key.
 *
 * 1. Read the existing managed provider key
 * 2. Fetch the authenticated model catalog
 * 3. Atomic model-only update + reload/rollback
 */
export async function refreshZosmaModels(
	piDir: string,
	deps: HandlerDependencies,
): Promise<{ modelCount: number; selectedModelId: string }> {
	loadRouterConfig(piDir);
	const modelsPath = join(piDir, "models.json");
	const provider = readProviderEntry(modelsPath, "zosmaai-router");
	if (!provider?.apiKey) {
		throw new Error("no zosmaai-router provider configured");
	}

	// Fetch authenticated entitlement catalog; inference stays on routerBaseUrl.
	const providerAuthBaseUrl = authBaseForProvider(provider);
	const modelsRes = await fetchImpl(`${providerAuthBaseUrl}/v1/models`, {
		headers: { Authorization: `Bearer ${provider.apiKey}` },
		redirect: "error",
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!modelsRes.ok) {
		throw new Error(`model catalog returned ${modelsRes.status}`);
	}
	const catalogBody = (await modelsRes.json()) as { data?: unknown[] };
	const rows = (catalogBody.data ?? []) as Array<Record<string, unknown>>;
	if (rows.length === 0) {
		throw new Error("no models entitled for this account");
	}

	const models: MappedModel[] = rows.map((r) => ({
		id: String(r.id),
		name: r.display_name ? String(r.display_name) : String(r.id),
		contextWindow:
			typeof r.context_window === "number"
				? r.context_window
				: typeof r.contextWindow === "number"
					? r.contextWindow
					: undefined,
		maxTokens:
			typeof r.max_tokens === "number"
				? r.max_tokens
				: typeof r.maxTokens === "number"
					? r.maxTokens
					: undefined,
		reasoning: Boolean(r.reasoning),
		input: mapInputCapability(r),
	}));

	// Snapshot and update only models, preserving key/baseUrl
	const prior = snapshotProvider(modelsPath, "zosmaai-router");
	try {
		saveCustomProvider(modelsPath, {
			id: "zosmaai-router",
			name: "Zosma AI",
			baseUrl:
				typeof provider.baseUrl === "string"
					? provider.baseUrl
					: currentConfig().routerBaseUrl,
			apiKey: provider.apiKey as string,
			models,
		});
		await deps.initAgent(deps.zosmaDir);

		const available = deps.modelRegistry.getAvailable();
		const expectedIds = new Set(models.map((m) => m.id));
		const registeredIds = new Set(
			available.filter((m) => m.provider === "zosmaai-router").map((m) => m.id),
		);
		for (const id of expectedIds) {
			if (!registeredIds.has(id)) {
				throw new Error(`model ${id} not found in registry after reload`);
			}
		}
	} catch (err) {
		restoreProvider(modelsPath, "zosmaai-router", prior);
		try {
			await deps.initAgent(deps.zosmaDir);
		} catch {
			// Best-effort re-init after rollback
		}
		throw err;
	}

	const selectedModel = models[0];
	return { modelCount: models.length, selectedModelId: selectedModel.id };
}

/**
 * Get Zosma account usage information.
 *
 * Fetches non-secret usage DTO from the auth service using the
 * scoped router device key. Returns only safe fields.
 */
export async function getZosmaUsage(piDir: string): Promise<{
	plan?: string;
	used?: number;
	limit?: number;
	resetAt?: string;
	usageAvailable?: boolean;
	providers?: Array<{
		provider: string;
		label: string;
		cap: number;
		used: number;
		remaining: number;
	}>;
	resetsInHours?: number;
	expiresAt?: string;
	daysLeft?: number;
	expired?: boolean;
}> {
	loadRouterConfig(piDir);
	const modelsPath = join(piDir, "models.json");
	const provider = readProviderEntry(modelsPath, "zosmaai-router");
	if (!provider?.apiKey) {
		throw new Error("no zosmaai-router provider configured");
	}

	const providerAuthBaseUrl = authBaseForProvider(provider);
	const res = await fetchImpl(`${providerAuthBaseUrl}/v1/me/usage`, {
		headers: { Authorization: `Bearer ${provider.apiKey}` },
		redirect: "error",
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!res.ok) {
		throw new Error(`usage endpoint returned ${res.status}`);
	}

	const body = (await res.json()) as {
		plan?: string;
		used?: number;
		limit?: number;
		reset_at?: string;
		usageAvailable?: boolean;
		providers?: Array<{
			provider?: unknown;
			label?: unknown;
			cap?: unknown;
			used?: unknown;
			remaining?: unknown;
		}>;
		resetsInHours?: number;
		expiresAt?: string;
		daysLeft?: number;
		expired?: boolean;
	};
	const providers = Array.isArray(body.providers)
		? body.providers
				.filter(
					(p) =>
						typeof p.provider === "string" &&
						typeof p.label === "string" &&
						typeof p.cap === "number" &&
						typeof p.used === "number" &&
						typeof p.remaining === "number",
				)
				.map((p) => ({
					provider: p.provider as string,
					label: p.label as string,
					cap: p.cap as number,
					used: p.used as number,
					remaining: p.remaining as number,
				}))
		: undefined;
	return {
		plan: body.plan,
		used: body.used,
		limit: body.limit,
		resetAt: body.reset_at,
		...(body.usageAvailable === undefined ? {} : { usageAvailable: body.usageAvailable }),
		...(providers === undefined ? {} : { providers }),
		...(body.resetsInHours === undefined ? {} : { resetsInHours: body.resetsInHours }),
		...(body.expiresAt === undefined ? {} : { expiresAt: body.expiresAt }),
		...(body.daysLeft === undefined ? {} : { daysLeft: body.daysLeft }),
		...(body.expired === undefined ? {} : { expired: body.expired }),
	};
}
