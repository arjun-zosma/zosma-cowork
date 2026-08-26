/**
 * Zosma Router Auth — orchestration.
 *
 * Re-port of agent-sidecar/src/zosma-auth/index.ts (sidecar deleted
 * 2026-08-26). Server-side: the Next.js web server now owns the whole
 * PKCE flow; no sidecar, no Tauri.
 *
 * Task 0 live probe (2026-08-26): production router.zosma.ai is a LiteLLM
 * proxy with NO /v1/cowork/* endpoints (404). The PKCE endpoints live on
 * the dev router (this machine's zosma-router-config.json points at
 * http://localhost:3000). Base URLs are config-driven, so the flow works
 * wherever the endpoints are deployed; authenticateWithKey (Task 7) is the
 * degraded path for endpoint-less environments.
 *
 * Frozen server contract (do not change):
 *   client_id is "zosma-cowork"
 *   POST {authBaseUrl}/v1/cowork/authorizations -> { authorization_url }
 *   POST {authBaseUrl}/v1/cowork/token          -> { access_token }
 *   GET  {authBaseUrl}/v1/models  (Bearer)      -> { data: [rows] }
 *   POST {authBaseUrl}/v1/cowork/revoke (Bearer)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { generateCodeVerifier, generateState, sha256Base64url } from "./crypto";
import { deletePending, loadPending, savePending } from "./state";
import { resolveRouterConfig } from "./router-config";
import { ZOSMA_PROVIDER_ID } from "./models-json";

export const ZOSMA_CLIENT_ID = "zosma-cowork";
export const DEVICE_ID_FILE = "zosma-device-id.txt";
const TIMEOUT_MS = 10_000;
const PENDING_TTL_MS = 10 * 60 * 1000;

/**
 * Injectable dependencies. Production wiring comes from productionDeps()
 * (Task 7); tests inject stubs.
 */
export interface ZosmaAuthDeps {
  /** Reload the pi model registry (production: invalidate web models cache). */
  reload: () => Promise<void>;
  /**
   * Models visible in the registry for one provider after reload.
   * Production: fresh ModelRuntime + getProvider(providerId).
   */
  getAvailable: (providerId: string) => Promise<Array<{ id: string; provider: string }>>;
  /** fetch override (tests). Defaults to globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
}

export interface StartAuthResult {
  authorizationUrl: string;
}

export interface CompleteAuthResult {
  providerId: string;
  selectedModelId: string;
  modelCount: number;
}

export interface ZosmaStatus {
  configured: boolean;
  pending: boolean;
  modelCount: number;
  baseUrl: string | null;
  authBaseUrl: string;
  routerBaseUrl: string;
}

function fetchImpl(deps: ZosmaAuthDeps): typeof globalThis.fetch {
  return deps.fetch ?? globalThis.fetch;
}

/**
 * Load or generate a stable device id. Persists to `<piDir>/zosma-device-id.txt`.
 */
export function loadDeviceId(piDir: string): string {
  const path = join(piDir, DEVICE_ID_FILE);
  try {
    if (existsSync(path)) {
      const existing = readFileSync(path, "utf-8").trim();
      if (existing) return existing;
    }
  } catch {
    // Unreadable file — generate a new id below.
  }
  const id = `cowork-${randomBytes(16).toString("hex")}`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, id, { mode: 0o600 });
  return id;
}

/**
 * Start the Zosma Router auth flow.
 *
 * 1. Generate state + PKCE code_verifier + S256 challenge
 * 2. Load/generate device id
 * 3. Persist pending transaction BEFORE the network call (crash-safe)
 * 4. POST {auth}/v1/cowork/authorizations
 * 5. Return authorizationUrl for the system browser
 *
 * `redirectUri` (optional): loopback callback URL forwarded to the auth
 * server so browsers can complete the flow over HTTP. Servers that ignore
 * it simply deep-link instead; the manual-paste path always works.
 */
export async function startZosmaAuth(
  piDir: string,
  deps: ZosmaAuthDeps,
  opts: { redirectUri?: string } = {},
): Promise<StartAuthResult> {
  const config = resolveRouterConfig(piDir);
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = sha256Base64url(codeVerifier);
  const deviceId = loadDeviceId(piDir);

  savePending(
    { state, codeVerifier, deviceId, expiresAt: Date.now() + PENDING_TTL_MS },
    piDir,
  );

  const body: Record<string, unknown> = {
    client_id: ZOSMA_CLIENT_ID,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    device_id: deviceId,
  };
  if (opts.redirectUri) body.redirect_uri = opts.redirectUri;

  const res = await fetchImpl(deps)(`${config.authBaseUrl}/v1/cowork/authorizations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    deletePending(piDir);
    throw new Error(`Auth server returned ${res.status}`);
  }

  const parsed = (await res.json()) as { authorization_url?: string };
  if (!parsed.authorization_url) {
    deletePending(piDir);
    throw new Error("Auth server returned missing authorization_url");
  }
  return { authorizationUrl: parsed.authorization_url };
}

/**
 * Default piDir for route handlers.
 */
export function zosmaPiDir(): string {
  return getAgentDir();
}
