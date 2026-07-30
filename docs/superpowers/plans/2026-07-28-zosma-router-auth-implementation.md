# Zosma Router Auth — implementation plan

**Design:** [`../specs/2026-07-28-zosma-router-auth-integration-design.md`](../specs/2026-07-28-zosma-router-auth-integration-design.md)  
**Backend plan:** [`../../../../llm-reseller/docs/superpowers/plans/2026-07-30-cowork-device-authorization-implementation.md`](../../../../llm-reseller/docs/superpowers/plans/2026-07-30-cowork-device-authorization-implementation.md)  
**Branch:** `feat/zosma-router-auth`  
**Backend prerequisite:** `llm-reseller` staging stages 1–5 deployed before enabling CTA.  
**No implementation is performed by this plan.**

## Delivery rule

Cowork must not expose **Continue with Zosma** until staging `auth.zosma.ai` authorization/token endpoints and staging `router.zosma.ai/v1/models` are live, authenticated, and manually verified. Sidecar code may land behind no visible CTA before then.

Google login stays in system browser. Cowork receives only a deep-link one-time code, then a Router device key after PKCE exchange. It never receives/stores Google credentials, browser cookies, dashboard default keys, or a Router key in `auth.json`/renderer state.

## Frozen wire contract

| Step | Cowork sends | Service returns | Trust boundary |
|---|---|---|---|
| Start | `POST https://auth.<env>.zosma.ai/v1/cowork/authorizations` `{ client_id, state, code_challenge, code_challenge_method: "S256", device_id }` | `{ authorization_url }` | sidecar only |
| Browser | system opens `authorization_url` | explicit `ai.zosma.cowork://oauth/callback?code=&state=` | browser → Tauri only |
| Complete | `POST https://auth.<env>.zosma.ai/v1/cowork/token` `{ client_id, code, code_verifier, device_id }` | `{ access_token, token_type: "Bearer" }` | sidecar only |
| Catalog | `GET https://router.<env>.zosma.ai/v1/models` Bearer device key | `{ object: "list", data: [...] }` | sidecar only |
| Revoke | `POST https://auth.<env>.zosma.ai/v1/cowork/revoke` Bearer device key | `204` | sidecar only |
| Usage P1 | `GET https://auth.<env>.zosma.ai/v1/me/usage` Bearer device key | non-secret usage DTO | sidecar only |

Production host constants must remain production-only in released builds. Staging test builds use staging hosts through a build/runtime configuration seam; do not edit source URLs manually before release.

## TDD and implementation rules

1. Before every production change, add one focused failing test. Watch failure for expected missing behavior, implement minimum code, rerun green, then refactor.
2. Use existing Vitest/React Testing Library and Rust tests. Do not add a test framework or runtime dependency.
3. Network, filesystem, Tauri IPC, deep-link APIs, and browser opening are external I/O: inject/mock them in tests. Exercise real pure parsing/mapping/transaction logic.
4. Never log/emit/store in frontend state: code verifier, authorization code, state, device key, Google token, or full auth URL query.
5. `models.json` necessarily stores device key for Pi. Continue atomic writes and restrictive permissions. Preserve all unrelated providers on every update/rollback.
6. Do not change API keys/custom-provider UI to expose the managed `zosmaai-router` entry.

## Stage 0 — reconcile existing sidecar work

### Existing implementation status

Phase 1 sidecar source already exists on this branch:

- `agent-sidecar/src/zosma-auth/crypto.ts`
- `agent-sidecar/src/zosma-auth/state.ts`
- `agent-sidecar/src/zosma-auth/index.ts`
- `agent-sidecar/src/commands/handlers/zosma-auth.ts`
- command type/registry/custom-provider support
- `crypto.test.ts` and `state.test.ts`

It passed `npx tsc --noEmit` and `npx vitest run` before this plan update. It was written against the approved contract, but backend did not yet exist. Treat it as provisional until stages below are tested against staging.

### First checks

1. Run baseline:
   ```bash
   cd agent-sidecar && npx tsc --noEmit && npx vitest run
   ```
2. Compare every request/body/header in `zosma-auth/index.ts` to frozen contract. Correct stale plan-only behavior: revoke uses Bearer header, never `{ token }` JSON; Google callback is Better Auth `/api/auth/callback/google`; catalog has no unauthenticated fallback.
3. Add `agent-sidecar/src/zosma-auth/index.test.ts` before changing sidecar production behavior. Inject `fetch`, temp Pi directory, provider read/write/reload dependencies, and deterministic clock/random values. Do not hit public hosts.
4. Add a regression test that existing manual custom providers and the old `zosmaai-router` snapshot survive failed setup/reload exactly.

## Stage 1 — sidecar hardening and complete command surface

### Files

- Modify `agent-sidecar/src/zosma-auth/index.ts`.
- Modify `agent-sidecar/src/zosma-auth/state.ts` only if tests expose a validation/cleanup gap.
- Modify `agent-sidecar/src/commands/handlers/zosma-auth.ts`.
- Modify `agent-sidecar/src/commands/types.ts` and `handler-registry.ts`.
- Add `agent-sidecar/src/zosma-auth/index.test.ts`.
- Extend `agent-sidecar/src/zosma-auth/state.test.ts`.

### Required behavior

#### Start

- Generate a fresh 256-bit `state` and RFC 7636 S256 verifier/challenge with Node built-in crypto.
- Read/create stable non-secret installation ID at `~/.pi/agent/zosma-device-id.txt` with user-only permissions.
- Persist `{ state, verifier, deviceId, expiresAt }` **before** authorization network call.
- If creation endpoint fails, delete only this pending transaction; never change an already configured provider.
- Use `redirect: "error"`, 10-second timeout, fixed HTTPS origin, JSON content type, no frontend exposure beyond authorization URL.

#### Complete

- Validate deep-link fields before network: nonempty strings, exact pending state, unexpired transaction. On state mismatch delete pending state and make no token request.
- Exchange once; any server `400 authorization_expired`/`authorization_invalid` deletes pending state and surfaces user-safe “Sign in again.”
- Validate token response exactly enough to require a nonempty `access_token` string. Do not serialize it in command result/errors.
- Fetch catalog with `Authorization: Bearer <key>`, `redirect: "error"`, timeout, no cache. Reject malformed/empty data before provider write.
- Map every server row to Pi model fields: `id`, `name <- display_name || id`, `contextWindow <- context_window`, `maxTokens <- max_tokens`, `reasoning`, and validated `input`. Omitted/invalid input means `['text']`; never infer vision from name.
- Snapshot only `providers.zosmaai-router`, write only that provider, reload registry through injected handler dependencies, verify every saved model appears, then choose previous valid selected model or first returned model.
- On save/reload/verify failure restore snapshot, reload prior registry, retain or delete pending transaction according to whether retry can safely use same code (normally delete after token exchange), and return safe error.
- Delete pending transaction only after successful setup or terminal token/state failure.

#### Cancel, refresh, disconnect, usage

Add commands now even if P1 UI lands later:

| Command | Sidecar action |
|---|---|
| `cancel_zosma_auth` | delete pending PKCE transaction only; never revoke/configure provider |
| `refresh_zosma_models` | read managed key locally, fetch/validate catalog, atomic model-only update + reload/rollback |
| `disconnect_zosma_auth` | read managed key, Bearer revoke best effort, remove managed provider, reload registry |
| `get_zosma_usage` | read managed key, Bearer fetch usage, validate/return safe DTO only |

Disconnect removes local configuration even if revocation is unavailable, but sends redacted warning to stderr only. It must not emit key data and must not delete a dashboard/manual provider.

### Tests first

Create individual tests for:

1. start persists transaction before fetch and clears it on failed create;
2. state mismatch makes zero network calls;
3. bad token/catalog responses make zero provider writes;
4. catalog metadata maps exact Pi capability fields and missing input becomes text-only;
5. success writes one managed provider, reloads, verifies, and returns only model count/selection/provider label;
6. reload failure restores prior managed provider and preserves unrelated provider entries;
7. cancel only removes pending state;
8. refresh changes models but never rotates/reveals key;
9. disconnect sends Bearer header, attempts revoke once, removes provider on server failure;
10. usage request has Bearer header and rejects unsafe/malformed response;
11. all fetches reject redirects and time out.

Run focused then full suite:

```bash
cd agent-sidecar
npx vitest run src/zosma-auth
npx tsc --noEmit
npx vitest run
```

## Stage 2 — managed-provider integration and credential detection

### Files

- Modify `agent-sidecar/src/custom-providers.ts`.
- Modify `agent-sidecar/src/commands/handlers/custom-providers.ts` only if metadata preservation is missing.
- Modify credential-status path in `agent-sidecar` and Tauri only after tracing its callers.
- Add/extend `agent-sidecar/src/custom-providers.test.ts`.

### Required behavior

- `zosmaai-router` stays in `RESERVED_PROVIDER_IDS`, is excluded from editable/deletable custom-provider listing, and is removable only via app-managed helper used by disconnect.
- `snapshotProvider`, `restoreProvider`, `readProviderEntry`, and `deleteProviderEntry` are the single mutation path for auth rollback/lifecycle. Do not duplicate JSON editing in auth module.
- `saveCustomProvider` preserves `name`, `contextWindow`, `maxTokens`, `reasoning`, `input`, compatibility, and thinking metadata. Router metadata must not be stripped by generic discovery/save.
- Authentication detection must recognize a configured/reloaded managed `zosmaai-router` provider even though it is hidden from `listCustomProviders`.
- Manual provider behavior, reserved legacy `zosmaai`, local model providers, and direct API-key onboarding remain unchanged.

### Tests first

- managed provider is hidden from custom list/edit/delete;
- app-managed delete can remove only the requested managed provider;
- saving/reloading preserves every router metadata field;
- credential status returns connected when only `zosmaai-router` is configured;
- failure rollback leaves original JSON byte-equivalent except permitted formatting normalization.

## Stage 3 — Tauri deep-link plumbing

### Files

- Modify root `package.json`/lockfile only to add official `@tauri-apps/plugin-deep-link` package.
- Modify `src-tauri/Cargo.toml` and `Cargo.lock` only to add official `tauri-plugin-deep-link` and needed single-instance feature.
- Modify `src-tauri/tauri.conf.json`.
- Modify `src-tauri/capabilities/default.json`.
- Modify `src-tauri/src/lib.rs`.
- Add focused Rust tests near URL/command forwarding helper where testable.

### Configuration

Register only scheme `ai.zosma.cowork` under deep-link desktop config. Initialize single-instance support before deep-link handling so a link activates the existing app. Add only `deep-link:allow-get-current` permission; do not grant broader shell/filesystem access.

Add thin Rust relay commands for `start_zosma_auth`, `complete_zosma_auth`, `cancel_zosma_auth`, `refresh_zosma_models`, `disconnect_zosma_auth`, and `get_zosma_usage`. Each generates request ID, forwards JSON to sidecar, uses finite command timeout, and returns `Result<Value, String>` with a safe message. Do not parse/store token/code in Rust except forwarding `code`/`state` arguments from the renderer to sidecar.

Use `tauri-plugin-shell` existing `open_url` command for browser launch. It must accept only returned HTTPS authorization URLs; URL validation belongs in tested frontend hook before invocation.

### Tests/checks first

1. Command serialization contains exact sidecar type/required fields but no token field.
2. Completion timeout returns error, does not panic.
3. Packaged/dev deep-link checks on Linux, macOS, Windows: first launch uses `getCurrent`; existing process receives `onOpenUrl`; invalid URL is ignored; same link delivers completion once.
4. Run:
   ```bash
   cargo test --workspace
   cargo fmt --check
   cargo clippy -- -D warnings
   ```

Do not call a browser deep link with a real authorization code in automated CI/logged shell history.

## Stage 4 — frontend hook and onboarding card

### Files

- Create `src/hooks/useZosmaAuth.ts`.
- Create `src/hooks/useZosmaAuth.test.ts`.
- Modify `src/components/HomeView.tsx`.
- Add/modify `src/components/HomeView.test.tsx` if existing component test setup permits; otherwise test the hook and smallest rendering unit.

### `useZosmaAuth` contract

State is exactly:

```ts
type Phase = 'idle' | 'starting' | 'waiting_browser' | 'completing' | 'done' | 'error';
```

The hook owns phase/error/non-secret setup result only. It does not retain token/code/state/verifier after `complete_zosma_auth` invocation.

1. `start()` invokes Tauri `start_zosma_auth`, validates returned `authorizationUrl` is `https://auth.<allowed-zosma-host>/connect/cowork?transaction=<one>`, opens it with existing `open_url`, then enters `waiting_browser`.
2. On `getCurrent()` startup and `onOpenUrl()` events, parse only exact deep link: protocol `ai.zosma.cowork:`, host `oauth`, path `/callback`, exactly one nonempty `code` and `state`, no duplicate query values, no extra accepted paths.
3. A ref keyed by `code + state` blocks duplicate delivery from startup and running-app APIs. Reset guard only after terminal error/reset as appropriate; never invoke sidecar twice for same link.
4. `complete()` invokes Tauri completion, dispatches existing `config-reload` only after success, and calls the supplied onboarding completion callback.
5. `cancel()` invokes `cancel_zosma_auth`, clears local phase, and does not revoke an existing provider.
6. Errors map server/IPC failures to safe, actionable text; do not render raw backend/HTTP details.
7. Effects unsubscribe cleanup properly. In React strict mode, listener setup must not cause duplicate completion.

### HomeView integration

On **connect** step, render Zosma card before manual API key and third-party OAuth rows:

```text
Continue with Zosma                         Recommended
Sign in with Google. Cowork sets up your available Zosma models automatically.
[ Continue with Google ]
```

Render one control per phase:

- idle: Continue button;
- starting: disabled spinner/text;
- waiting browser: “Complete sign-in in your browser” and Cancel;
- completing: “Setting up your models”; no Cancel;
- done: connected/model-count confirmation until `onComplete` transfers to chat;
- error: safe message and Retry.

Use existing buttons/icons/tokens where available. Keep keyboard focus, disabled state, visible loading text, and text contrast accessible. Do not add a second wizard, new state store, or custom browser window.

### Tests first

1. start path calls start then open URL and reaches waiting;
2. failed start/open enters error and never leaks returned URL query in UI;
3. valid launch/current deep link completes once;
4. wrong scheme/host/path, duplicate parameters, missing values cause zero invoke calls;
5. duplicate current/event delivery invokes complete once;
6. cancel invokes sidecar cancel and does not call revoke;
7. success dispatches `config-reload` after completion and calls HomeView `onComplete`;
8. card phase rendering exposes correct button/status for every phase.

Run:

```bash
npm test -- useZosmaAuth HomeView
npm run lint
npm run typecheck
npm run build:frontend
```

## Stage 5 — P1 connected-account controls

### Files

- Create `src/components/settings/ZosmaStatus.tsx` and tests.
- Add it to existing settings composition after locating its current provider/account section.
- Reuse `useZosmaAuth` or a small focused `useZosmaAccount` helper only if UI lifecycle needs independent loading state.

Render connected/disconnected status, current selected model/model count, safe usage summary, **Refresh models**, **Reconnect**, and **Disconnect**. No raw key, Google identity token, full billing identifier, or device ID appears.

- Refresh calls `refresh_zosma_models`, shows model count, preserves valid selected model, and reloads config only after success.
- Reconnect reuses browser flow; backend replaces only same-install key.
- Disconnect requires clear confirmation, invokes disconnect, clears local provider/config, preserves chat history, then routes to reconnect/manual onboarding.
- A router `401` in normal chat marks Zosma disconnected and offers reconnect; never loops retries with stale credential.

Tests first: usage renders safe DTO; refresh success/error; disconnect confirmation and server-failure-local-removal behavior; reconnect opens auth; unrelated provider/settings state survives.

## Stage 6 — integration against staging and packaged apps

Do this only after backend staging checklist passes.

### Controlled staging run

1. Create fresh Cowork profile/temp `~/.pi/agent`; retain separate profile with manual provider to check preservation.
2. Point only local development/test build to `auth.staging.zosma.ai` and `router.staging.zosma.ai` through approved configuration. Do not commit staging URLs as production defaults.
3. Start login, complete Google in browser, click explicit deep-link button, and confirm one successful completion.
4. Confirm `models.json` has one managed `zosmaai-router` provider, correct staging base URL, user-only file permission, and no `auth.json` mutation.
5. Confirm catalog model capability metadata controls image attachment correctly.
6. Restart between browser launch and deep link; completion succeeds before 10-minute expiry.
7. Deliver same deep link twice; one token exchange/provider save only.
8. Test expired code, mismatched state, wrong device, no entitlement, catalog 401, malformed catalog, and reload failure. No stale provider/chat transition.
9. Connect second Cowork install; reconnect/disconnect first; second and dashboard default key remain valid.
10. Test installed Linux/macOS/Windows builds, not only dev server, for URL-scheme registration and existing-instance behavior.

### Final local commands

```bash
cd agent-sidecar && npx tsc --noEmit && npx vitest run
cd .. && npm run lint && npm run typecheck && npm test && npm run build:frontend
cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test --workspace
cd ../agent-sidecar && npm run build
```

## Stage 7 — documentation PR, feature PR, production promotion

### Documentation PR now

This branch contains unrelated/uncommitted implementation work. Commit docs separately; do not sweep all files into the docs commit.

```bash
git add docs/superpowers/specs/2026-07-28-zosma-router-auth-integration-design.md \
  docs/superpowers/plans/2026-07-28-zosma-router-auth-implementation.md
git commit -m "docs: plan Zosma Router device auth"
git push -u origin feat/zosma-router-auth
```

Open a Cowork PR against its normal integration branch. Its description must state: backend staging deployment is a hard prerequisite; no frontend CTA is live in this docs-only PR.

### Feature and release order

1. Merge backend PR to `staging`, deploy it, and complete backend staging acceptance.
2. Implement/merge Cowork sidecar + Tauri + UI feature PR behind disabled CTA/config gate.
3. Run Stage 6 with Cowork build pointed to staging. Fix contracts on staging only; update both specs/plans when contract changes.
4. Merge/promote reviewed backend commit from `staging` to `main`; verify production auth/catalog ingress before changing Cowork release configuration.
5. Build Cowork release using production hosts, run one production smoke login with a disposable account, then enable CTA/release rollout.
6. If production backend is unavailable or returns unexpected catalog, keep manual onboarding usable and disable Zosma CTA; do not fall back to hardcoded models/default dashboard key.

## Final acceptance

- One normal user signs in through browser and reaches chat only after provider save/reload/model verification.
- Google credentials never enter Cowork disk, sidecar protocol logs, frontend state, analytics, or error UI.
- Device key is scoped to one install and stored only where Pi needs it.
- Every failure leaves existing providers/chat history intact and presents retry/reconnect path.
- Dashboard/manual keys and other Cowork installs survive reconnect/disconnect.
- Model list/capabilities come only from authenticated Router catalog.
- Staging backend + packaged Cowork flow pass before any production client target/CTA is enabled.
