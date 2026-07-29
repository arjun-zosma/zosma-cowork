# Zosma Router Auth Integration — Design Spec

> Status: Draft
> Scope: Zosma Cowork first-run sign-in and Zosma Router model setup
> Backend companion: [`llm-reseller Cowork Device Authorization`](../../../../llm-reseller/docs/superpowers/specs/2026-07-29-cowork-device-authorization-design.md)

---

## 1. Goal

First launch must work end to end:

1. User selects **Continue with Zosma** in Cowork.
2. System browser opens Google sign-in on `auth.zosma.ai`.
3. Browser returns a one-time code to Cowork.
4. Cowork exchanges code, writes the authenticated Zosma Router provider to Pi's `models.json`, reloads Pi, verifies models, selects a valid model, then enters chat.

No API-key copy/paste. No chat screen until setup has succeeded.

Existing manual API-key, OAuth, and custom-provider flows remain unchanged.

---

## 2. Decisions

| Decision | Choice |
|---|---|
| Browser auth | System browser, never embedded webview |
| Google callback | Better Auth fixed callback: `https://auth.zosma.ai/api/auth/callback/google` |
| Cowork return | `ai.zosma.cowork://oauth/callback?code=…&state=…` |
| Return payload | One-time authorization code, never router key or Google token |
| Proof against intercepted link | Authorization Code + PKCE + state |
| Auth frontend | New `/connect/cowork` route in existing user dashboard/auth app; no second frontend/repo required |
| Router model source | Authenticated `GET https://router.zosma.ai/v1/models`; no hardcoded fallback models |
| Pi provider id | `zosmaai-router`, OpenAI Completions protocol; do not reuse existing `zosmaai` Anthropic provider |
| Google credentials on desktop | Never stored. Cowork stores only scoped, revocable router device key required by Pi |

`auth.zosma.ai/dashboard` remains user dashboard. Cowork flow uses a small route in same application, not dashboard UI. Normal web login and Cowork login are different **transactions**, not different Google callbacks.

---

## 3. User Stories

| Story | Priority |
|---|---|
| New user signs in with Google and reaches working chat without pasting a key | P0 |
| User sees only models their account can use | P0 |
| User can attach images only to models declaring image input | P0 |
| Browser login knows whether to return to Cowork or user dashboard | P0 |
| App restart during browser login can still safely finish setup | P0 |
| Failed setup never opens chat with stale or unusable models | P0 |
| User can reconnect/re-authenticate without duplicate providers | P1 |
| User can see plan/remaining usage in Cowork | P1 |
| User can revoke one Cowork device without breaking other devices | P1 |

---

## 4. End-to-End Protocol

### 4.1 Start from Cowork

Cowork UI invokes sidecar command `start_zosma_auth`.

Sidecar:

1. Creates 256-bit random `state` and PKCE `code_verifier`.
2. Derives S256 `code_challenge`.
3. Generates/persists non-secret `device_id` once per install.
4. Stores `{ state, code_verifier, expiresAt, device_id }` as a pending transaction. It must survive app restart and expire after 10 minutes.
5. Calls `POST https://auth.zosma.ai/v1/cowork/authorizations` with `state`, `code_challenge`, `code_challenge_method=S256`, `device_id`, and fixed client id `zosma-cowork`.
6. Receives `{ authorization_url }` and returns only that URL to frontend.

Frontend opens `authorization_url` through existing Rust `open_url`. It never receives a router key, Google token, or PKCE verifier.

### 4.2 auth.zosma.ai and Google

Auth service creates a short-lived server-side transaction:

```text
id, flow="cowork", state_hash, code_challenge, device_id, expires_at, consumed_at
```

Browser reaches `https://auth.zosma.ai/connect/cowork?transaction=<opaque-id>`.

- If user lacks auth session: start Google OAuth.
- Google always redirects to Better Auth's one registered callback: `https://auth.zosma.ai/api/auth/callback/google`.
- Better Auth returns to the server-owned transaction completion route; that route looks up its transaction and `flow`.
  - `flow="web"` → user dashboard.
  - `flow="cowork"` → Cowork success page with **Open Zosma Cowork** button.

No guesswork from user-agent, referrer, or redirect URL. Transaction decides destination.

After Google identity is verified, service creates a one-time authorization code bound to transaction, user, `code_challenge`, and `device_id`. Code expires in 60 seconds and can be consumed once.

Button opens:

```text
ai.zosma.cowork://oauth/callback?code=<one-time-code>&state=<state>
```

The code is not a credential. PKCE makes an intercepted code unusable without Cowork's local verifier.

### 4.3 Complete in Cowork

Deep-link handler accepts only this exact shape:

- scheme: `ai.zosma.cowork`
- host: `oauth`
- path: `/callback`
- one non-empty `code`
- one non-empty `state`

It invokes sidecar command `complete_zosma_auth(code, state)`. Sidecar, not renderer:

1. Looks up pending transaction; requires exact state and unexpired verifier.
2. Exchanges code and verifier at `POST https://auth.zosma.ai/v1/cowork/token`.
3. Receives a scoped Zosma Router device key. It does **not** receive or persist a Google token.
4. Calls authenticated `GET https://router.zosma.ai/v1/models` with that key.
5. Validates non-empty router response and maps every allowed model to Pi model shape.
6. Upserts provider `zosmaai-router` into `~/.pi/agent/models.json`.
7. Reloads Pi `ModelRegistry`.
8. Verifies every saved model now appears in registry and selects router default model, or first returned model.
9. Deletes pending transaction and returns non-secret setup result: provider display name, selected model id, and model count.

Only then frontend dispatches `config-reload`, clears onboarding, and displays chat.

Use an in-flight guard keyed by `state`. Tauri `getCurrent()` and `onOpenUrl()` may both observe same launch link; second completion must be ignored, not consume code twice.

---

## 5. `models.json` Contract

Cowork uses existing Pi custom-provider storage. Exact saved shape:

```json
{
  "providers": {
    "zosmaai-router": {
      "name": "Zosma AI",
      "baseUrl": "https://router.zosma.ai/v1",
      "apiKey": "<scoped-router-device-key>",
      "api": "openai-completions",
      "models": [
        {
          "id": "<router-model-id>",
          "name": "<router-display-name>",
          "contextWindow": 131072,
          "maxTokens": 16384,
          "reasoning": false,
          "input": ["text", "image"]
        }
      ]
    }
  }
}
```

Numbers above are shape examples only. Cowork must use values returned by router. Never seed unavailable models such as `mimo-v2.5` or `deepseek-v4-flash` as a fallback.

### Model capabilities

Pi consumes `input`, not `modalities`:

| Router field | Pi `models.json` field | Meaning |
|---|---|---|
| `id` | `id` | Stable model identifier |
| `display_name` | `name` | User-facing label |
| `input: ["text", "image"]` | `input: ["text", "image"]` | Model accepts image attachments |
| `input: ["text"]` | `input: ["text"]` | Text-only model |
| `context_window` | `contextWindow` | Context limit |
| `max_tokens` | `maxTokens` | Output token limit |
| `reasoning` | `reasoning` | Enables thinking controls only when true |

`input` absent means text-only. Never claim image support based on model name.

### Router catalog response

`GET /v1/models` must require Bearer auth and return only models enabled for that user/key:

```json
{
  "data": [
    {
      "id": "provider/model-id",
      "type": "model",
      "display_name": "Model name",
      "input": ["text", "image"],
      "context_window": 131072,
      "max_tokens": 16384,
      "reasoning": true
    }
  ]
}
```

`src/routes/models.ts` must extend `ModelEntry` with these optional capability fields. Existing Cowork discovery understands `input`; it must be extended to preserve name, context window, output limit, and reasoning instead of retaining only id/input.

### Atomic setup and reload

Existing `save_custom_provider` writes `models.json`, but current handler does not reload the active `ModelRegistry`. Its Rust comment says it does; implementation must be corrected.

`complete_zosma_auth` must reuse `saveCustomProvider()` then:

1. Snapshot existing `providers.zosmaai-router`.
2. Write only that provider; preserve all unrelated providers.
3. Call `initAgent()` / registry reload.
4. Verify registry exposes saved router models.
5. If reload or verification fails, restore snapshot, reload previous registry, return error, and keep onboarding open.

This prevents landing in chat with saved-but-invisible models.

`zosmaai-router` is app-managed:

- Add it to `RESERVED_PROVIDER_IDS`; custom-provider UI must not offer delete/edit.
- Update `has_credentials` to recognize configured `zosmaai-router` directly. It currently derives custom credentials from `listCustomProviders`, which excludes reserved ids.
- Add dedicated Settings actions: **Reconnect**, **Refresh models**, **Disconnect**.

---

## 6. Cowork Changes

### Sidecar

New commands:

| Command | Responsibility |
|---|---|
| `start_zosma_auth` | Generate/store state + PKCE verifier; obtain browser authorization URL |
| `complete_zosma_auth` | Validate deep link; exchange code; catalog fetch; atomic provider save; Pi reload and verification |
| `get_zosma_usage` | P1. Fetch account quota through sidecar using router key; return non-secret usage only |
| `disconnect_zosma_auth` | P1. Revoke current device key server-side, remove provider, reload Pi |
| `refresh_zosma_models` | P1. Fetch authenticated catalog and atomically update models without rotating key |

Pending PKCE state must use app-private storage, restrictive permissions, and cleanup on completion/expiry. It contains no access token. Never put verifier, code, or router key in logs, events, analytics, errors, or frontend state.

Extend custom-provider model input types with `input?: ("text" | "image")[]`; current public frontend `SaveCustomProviderInput` omits it although sidecar supports it.

### Tauri deep links

Use official `tauri-plugin-deep-link` and single-instance integration. Static desktop configuration:

```json
{
  "plugins": {
    "deep-link": {
      "desktop": { "schemes": ["ai.zosma.cowork"] }
    }
  }
}
```

- Initialize single-instance plugin before deep-link plugin so an existing window receives a link.
- Add plugin capability permission for `deep-link:allow-get-current`.
- macOS requires static scheme registration in bundled config. Test installed app, not only dev server.

Frontend uses `getCurrent()` at startup and `onOpenUrl()` while running from `@tauri-apps/plugin-deep-link`; do not listen for invented generic `deep-link://requested` events.

### Onboarding

`HomeView.tsx` gains one recommended card:

```text
Continue with Zosma
Sign in with Google. Cowork sets up your available Zosma models automatically.
[ Continue with Google ]
```

Button invokes `start_zosma_auth`, then existing `open_url`. While browser flow is pending, card shows waiting state and **Cancel**. Cancel removes pending transaction only; it does not revoke any existing provider.

On error, show retry action. Do not show raw router key on auth success page or in Cowork. Manual custom-key setup remains separate for advanced users.

---

## 7. User Dashboard and Usage

One Google callback supports both dashboard and Cowork because auth transaction records `flow`.

- Browser dashboard login creates `flow="web"`, then callback enters dashboard.
- Cowork start command creates `flow="cowork"`, then callback offers deep-link return.

P1 usage endpoint: `GET https://auth.zosma.ai/v1/me/usage`, called by sidecar with `Authorization: Bearer <scoped-router-device-key>`. It returns plan, limits, usage, and reset time only.

`POST https://auth.zosma.ai/v1/cowork/revoke` likewise authenticates with `Authorization: Bearer <scoped-router-device-key>` and returns no key data. The device key must never be sent in a JSON body.

Do not store/send Google access or refresh tokens to obtain usage. Google establishes identity at auth service; Zosma's own router device key authenticates Cowork afterward. `auth.json` remains untouched by this flow; Pi reads the device key only from the managed `zosmaai-router` entry in `models.json`.

---

## 8. Failure Handling

| Case | Required behavior |
|---|---|
| User cancels Google page | Cowork stays onboarding; pending transaction expires/cleans up |
| Link opened by wrong app | PKCE verifier missing; exchange fails safely; no key leak |
| State mismatch, duplicate params, wrong URL shape | Reject without network exchange; keep onboarding |
| Link arrives twice | First in-flight completion wins; later event ignored |
| Cowork restarted during login | Pending verifier restored; completion succeeds before expiry |
| Code expired/used | Show “Sign in again”; delete pending transaction |
| Exchange denied | Keep prior provider unchanged; show retry |
| Catalog request fails, is unauthorized, malformed, or empty | Do not save provider; show retry |
| Save/reload/registry verification fails | Restore old provider/config; keep onboarding |
| Re-auth existing install | Idempotently replaces only `zosmaai-router`, refreshes catalog, selects valid model |
| Device key revoked or inference returns 401 | Preserve chat history; mark Zosma disconnected; offer reconnect |
| User has no entitled models | Show account/plan message, no model saved, no chat completion |

---

## 9. Security Requirements

- Authorization Code + PKCE S256 + high-entropy state. Follow RFC 8252 and RFC 7636.
- Only exact registered Google callback URL accepted. Auth transaction chooses post-login flow.
- Code: 60-second TTL, one use, bound to state, challenge, user, device id.
- Pending transaction: 10-minute TTL, deleted after use/cancel/expiry.
- Router device key: scoped to inference and account usage, revocable, per device/install, and rotatable. Do not issue account-wide permanent key to every Cowork login.
- `models.json` necessarily contains router key because Pi's custom OpenAI provider reads `apiKey` there. This is not OS-keychain storage. Write atomically with user-only permissions (`0600` file / `0700` directory on POSIX; current-user ACL on Windows). Do not claim Google token is stored there; it must never be stored.
- Use HTTPS, fixed auth/router origins, request timeouts, and no redirects for token/catalog exchanges.
- Rate-limit login starts and exchanges. Audit user/device/key id, never raw code, verifier, Google token, or router key.
- Disconnect revokes server key before local deletion. If server revocation fails, Cowork warns without exposing the key, removes its local provider, and a later sign-in issues a new device key. The server must expire abandoned device keys with the user entitlement.

---

## 10. Acceptance Tests

| Test | Expected result |
|---|---|
| Fresh install, successful Google login | Provider written, Pi reloaded, authenticated catalog models visible, one selected, chat opens |
| Router returns text + image model | Saved model has `input: ["text", "image"]`; image attachment enabled |
| Router returns text-only model | Saved model has `input: ["text"]`; image attachment blocked/warned |
| Router returns no models | Setup fails before write; onboarding stays open |
| Re-auth with existing provider | One `zosmaai-router` provider, refreshed key/catalog, no duplicate |
| Other custom providers exist | They survive setup unchanged |
| Reload failure injected | Original provider restored; chat not opened |
| App closes before deep link | Restart completes from persisted pending PKCE state |
| Duplicate deep-link delivery | One exchange and one provider save |
| Wrong state/code/scheme/path | No exchange and no configuration change |
| Intercepted code without verifier | Exchange rejected |
| Existing app receives link | Existing window focused and completes setup; no second app window |
| Revoked device key | Inference failure surfaces reconnect, never silently retries with invalid key |
| Dashboard Google login | Same Google callback reaches dashboard, never Cowork deep link |
| Manual key/custom provider flow | Existing behavior unchanged |

Unit tests required for URL validation, PKCE/state lifecycle, response-to-Pi mapping, rollback, and idempotent completion. Integration test required against test auth/router endpoints. Manual installed-app tests required on macOS, Windows, Linux.

---

## 11. Delivery Order

1. Auth service: transaction store, Google callback routing, code exchange, device-key issuance/revocation.
2. Router: authenticated catalog and full capability metadata.
3. Cowork sidecar: start/complete commands, detailed catalog mapping, atomic save/reload/rollback, credential detection.
4. Cowork Tauri: deep-link + single-instance configuration and permissions.
5. Cowork frontend: onboarding waiting/retry states and deep-link handler.
6. End-to-end tests on packaged apps.
7. P1 usage, reconnect, refresh, and disconnect UI.

---

## 12. Out of Scope

- Embedded login webview.
- Google tokens or Google API access inside Cowork.
- Billing/upgrade purchase flow in Cowork.
- Image output support.
- Model fallback when authenticated catalog is unavailable.
