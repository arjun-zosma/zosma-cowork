# Zosma Router Onboarding and Announcement — Implementation Plan

**Spec:** [`../specs/2026-07-31-zosma-router-onboarding-announcement.md`](../specs/2026-07-31-zosma-router-onboarding-announcement.md)

**Status:** Draft for review. No implementation is performed by this plan.

**Repository:** `zosma-cowork`

**Implementation rule:** Do not use `push-task` for this work. Implement directly after plan approval, in small TDD increments. Do not push or commit until explicitly requested.

---

## 1. Outcome

Replace the current forced new-user Zosma login route with one coherent onboarding model:

```text
splash
  |
  +-- new user ----------------------> HomeView connect screen
  |                                      Zosma first
  |                                      More ways to connect
  |
  +-- existing user, no Zosma --------> normal chat
  |                                      + announcement modal
  |
  +-- existing user, Zosma connected -> normal chat
```

Required behavior:

1. New users see `HomeView` directly in its **Connect** step, not a separate `ZosmaLoginScreen`.
2. Zosma Router is the recommended first card with Google CTA, model/value copy, and 100 free requests/day copy.
3. `More ways to connect` expands existing Claude, ChatGPT, GitHub Copilot, API-key, and local/custom journeys.
4. Third-party subscription options continue to use OAuth/device flows. They must not become API-key forms.
5. Existing users are not blocked by Zosma authentication.
6. Existing users without Zosma see a branded, dismissible, versioned release announcement over chat.
7. Connected Zosma users see no announcement.
8. Settings shows Zosma Router first.
9. Existing provider credentials, custom providers, selected model, chat history, and local configuration survive all Zosma failures.
10. No credential, device key, OAuth code, verifier, or identity token enters renderer state, announcement storage, telemetry, or user-visible errors.

---

## 2. Current Code Baseline

The implementation model must account for current code rather than assuming a blank app.

### Current startup

- `src/App.tsx` imports and renders `ZosmaLoginScreen` when `!hasCredentials`.
- `src/hooks/useAuth.ts` exposes only `hasCredentials`, `loading`, and `saveApiKey`.
- `src-tauri/src/lib.rs::has_credentials` checks auth providers, managed `zosmaai-router`, and custom providers, but does not expose a separate onboarding status.
- `src-tauri/src/lib.rs::spawn_sidecar` currently forces `ZOSMA_PI_AGENT_DIR` to a Cowork-private directory.
- `App.tsx` hides app chrome while `models.length === 0`, which can create a model-loading/onboarding race.

### Current onboarding

- `src/components/HomeView.tsx` already has `splash` and `connect` steps.
- Its connect step already renders a Zosma card, API-key form, custom provider row, and OAuth provider cards.
- Zosma card currently appears independently of a `More ways to connect` expansion.
- `HomeView` already uses `useZosmaAuth` and has Zosma phase rendering.
- `src/components/ZosmaLoginScreen.tsx` duplicates Zosma auth presentation and must be retired from normal startup.
- `src/components/ProviderAuthSection.tsx` owns existing provider OAuth/device lifecycle and must be reused unchanged unless tests expose a real integration issue.

### Current settings

- `src/components/settings/Authentication.tsx` currently renders third-party OAuth rows, API key row, then `ZosmaStatus`, then custom providers.
- `ZosmaStatus` already owns connected/disconnected/refresh/reconnect/disconnect behavior.
- The final order must put `ZosmaStatus` first, then third-party OAuth, API keys, and custom providers.

### Existing design primitives

- Use `src/components/ui/dialog.tsx` for the announcement modal.
- Use existing `panel-raised`, `glass`, `brand-gradient`, `bg-primary`, `text-primary`, and related utilities.
- Follow `docs/DESIGN.md` and `npm run lint:styles`; do not add hard-coded blue or inline `hsl(var(--token))` styles.

---

## 3. Non-Negotiable Rules for Implementer

### TDD

For every production behavior change:

1. Add the smallest failing test.
2. Run only that test and confirm expected failure.
3. Implement the minimum change.
4. Run focused test until green.
5. Refactor only after green.
6. Run the relevant full suite before moving stages.

Do not write a large batch of production code first and add tests afterward.

### Security

Never put these values in React state, DOM, local storage, telemetry, thrown UI errors, or logs:

- Zosma device key;
- Google access/refresh token;
- PKCE verifier;
- authorization code;
- full callback query string;
- raw authorization URL query values;
- account identity unless already explicitly non-secret status data.

The existing sidecar/Tauri Zosma auth flow remains the only place that handles secrets.

### Provider preservation

Never delete or rewrite all providers as part of onboarding. Zosma mutations must be limited to managed provider `zosmaai-router`. Existing OAuth providers, API keys, custom endpoints, and local models remain unchanged.

### No speculative architecture

Do not add a global store, new onboarding framework, provider abstraction, analytics campaign framework, or new design system. Reuse `HomeView`, `ProviderAuthSection`, `CustomProviderRow`, `ZosmaStatus`, `useZosmaAuth`, and `Dialog`.

---

## 4. Target State Contract

Add an explicit non-secret startup status instead of using `hasCredentials` for every decision.

```ts
export interface OnboardingStatus {
  hasExistingSetup: boolean;
  zosmaConnected: boolean;
}
```

### Meaning

`hasExistingSetup` is true when persisted user configuration exists:

- at least one authenticated provider in `auth.json`; or
- a persisted managed Zosma provider; or
- a persisted custom/local provider or meaningful saved model configuration.

`zosmaConnected` is true only when managed provider `zosmaai-router` exists with a usable saved configuration.

Runtime model availability alone must not be used as proof of existing setup. An extension-provided catalog must not skip onboarding.

### Required implementation seam

Prefer one sidecar command, `get_onboarding_status`, returning the contract above. It should read the same Pi state directory used by the sidecar and return no secrets.

Do not make the frontend independently inspect filesystem paths. Do not make Rust duplicate JSON parsing if sidecar already owns the Pi paths.

### Important state-directory correction

Production Cowork must use normal `~/.pi/agent` state so existing Pi users are recognized. Keep `ZOSMA_PI_AGENT_DIR` only when explicitly supplied for development/tests. Remove the unconditional Rust export.

Before changing this behavior, verify all callers of `piAgentDir()` and all test isolation assumptions. Update tests to set the override explicitly where isolation is required.

---

## 5. File Map

### New files

- `src/hooks/useOnboardingStatus.ts`
- `src/hooks/useOnboardingStatus.test.ts`
- `src/components/ZosmaRouterAnnouncement.tsx`
- `src/components/ZosmaRouterAnnouncement.test.tsx`
- `agent-sidecar/src/commands/handlers/onboarding.ts` if command handling is not better placed in existing core/auth handler module
- `agent-sidecar/src/commands/handlers/onboarding.test.ts` only if handler behavior needs direct coverage
- `agent-sidecar/src/onboarding-status.ts`
- `agent-sidecar/src/onboarding-status.test.ts`

### Frontend files to modify

- `src/App.tsx`
- `src/components/HomeView.tsx`
- `src/components/HomeView.test.tsx`
- `src/components/ZosmaLoginScreen.tsx` — delete or leave unused only if repository policy requires staged removal; preferred outcome is deletion after migration
- `src/components/ZosmaLoginScreen.test.tsx` — replace with HomeView coverage or delete after no import remains
- `src/components/settings/Authentication.tsx`
- `src/components/settings/Authentication.test.tsx`
- `src/components/settings/ZosmaStatus.tsx` only if announcement/auth callback integration requires a small prop change
- `src/components/SettingsPage.tsx` only if settings navigation needs no other change; inspect before editing
- `src/types/auth.ts` or a new nearby type file for `OnboardingStatus`, depending on existing type conventions
- `src/App.telemetry.test.tsx`

### Sidecar files to modify

- `agent-sidecar/src/commands/types.ts`
- `agent-sidecar/src/commands/handler-registry.ts`
- `agent-sidecar/src/commands/handlers/core.ts` or new onboarding handler
- `agent-sidecar/src/agent-init.ts` only if state-directory behavior requires no existing helper
- `agent-sidecar/src/custom-providers.ts` only if status detection needs an existing helper exposed
- relevant sidecar tests for command protocol and state detection

### Tauri files to modify

- `src-tauri/src/lib.rs`
- Tauri tests/helpers covering relay command registration or sidecar environment setup

### Documentation

- This plan and the approved spec only. Do not modify implementation code until plan approval.

---

## 6. Stage 0 — Baseline and Contract Reconnaissance

### Goal

Establish current behavior and prevent the small implementation model from fixing the wrong state path.

### Read and trace first

Trace these end-to-end before edits:

1. `App.tsx` → `useAuth` → Rust `has_credentials` → sidecar `get_auth_status`.
2. `App.tsx` → `useProviders` → `models.length` startup gate.
3. `HomeView` connect step → `useZosmaAuth` → `start_zosma_auth`/deep link/config reload.
4. `HomeView` OAuth cards → `ProviderAuthSection` → existing Tauri OAuth commands/events.
5. `Authentication` → `ZosmaStatus`, API key row, custom provider row.
6. Rust sidecar environment → `piAgentDir()` → `auth.json`/`models.json`.

### Baseline commands

```bash
npm test
npm run lint
npm run lint:styles
npm run typecheck
npm run build:frontend
cd agent-sidecar && npx tsc --noEmit && npm test
cd ../src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test --workspace
```

Record baseline failures separately. Do not broaden this feature to unrelated pre-existing failures.

### Stage 0 tests to add first

Add a failing status contract test for these cases:

| auth.json | models/custom config | managed Zosma | expected existing | expected connected |
|---|---|---:|---:|---:|
| none | none | no | false | false |
| provider | none | no | true | false |
| none | custom/local | no | true | false |
| none | managed provider | yes | true | true |
| provider | custom/local | no | true | false |

Also add a regression test showing runtime model catalog entries without persisted user setup do not classify the user as existing.

### Exit criteria

- Status contract and file-state semantics are agreed in code comments/tests.
- No implementation has changed yet beyond tests.
- Baseline commands and known failures are recorded in the implementation PR notes.

---

## 7. Stage 1 — Sidecar Onboarding Status

### Goal

Make one sidecar-owned, non-secret status query the source of truth for startup classification.

### Implementation

1. Add `OnboardingStatus` type in the shared command/type location.
2. Add `get_onboarding_status` command type and handler registration.
3. Implement pure file/status logic in `agent-sidecar/src/onboarding-status.ts`.
4. Reuse existing `piAgentDir()` and provider helpers; do not duplicate path resolution.
5. Read only necessary metadata:
   - whether authenticated providers exist;
   - whether managed `zosmaai-router` is configured;
   - whether meaningful custom/local/model configuration exists.
6. Return booleans only. Never return file contents, provider keys, account IDs, or model API keys.
7. Make malformed/missing files resolve safely to `false` rather than crashing startup.
8. Ensure sidecar command uses the same state directory as all other Pi commands.

### Detection details

The implementation must distinguish persisted configuration from extension catalog availability:

- `auth.json` provider entries count as existing setup.
- Managed `zosmaai-router` counts as both existing and connected only when its saved provider entry is valid enough for inference.
- Custom/local provider entries count as existing even when they use the `NO_AUTH_SENTINEL`.
- Empty/malformed files do not count.
- Do not count a transient in-memory `getAvailable()` model list by itself.
- If `models.json` semantics are ambiguous because initialization creates it automatically, add a pure fixture test that proves empty/runtime-created config is ignored and user provider/model config counts. Do not use file existence alone if it makes every fresh install existing after first boot.

### Tests first

Add tests for:

1. no files → `{ false, false }`;
2. auth-only provider → existing true;
3. custom/local provider with no real key → existing true;
4. managed Zosma only → existing and connected true;
5. managed Zosma malformed/missing key → existing based on persisted config, connected false;
6. runtime catalog without saved setup → existing false;
7. malformed JSON → safe false result;
8. status never includes raw key or file content.

Run:

```bash
cd agent-sidecar
npx vitest run src/onboarding-status.test.ts
npx tsc --noEmit
```

### Exit criteria

Frontend can invoke one command and receive stable status booleans. Existing `has_credentials` callers remain compatible until App migration is complete.

---

## 8. Stage 2 — Tauri Relay and Production State Directory

### Goal

Expose status to the frontend and stop forcing private Pi state in production.

### Tauri changes

1. Add `get_onboarding_status` relay command using existing sidecar request/response pattern.
2. Register command in `invoke_handler`.
3. Use unique request IDs and finite timeout.
4. Return `Result<Value, String>` with safe errors.
5. Do not parse secrets in Rust.

### State-directory changes

Replace this current behavior:

```rust
c.env("ZOSMA_PI_AGENT_DIR", PathBuf::from(zm).join("pi-agent"));
```

with:

- inherit explicit `ZOSMA_PI_AGENT_DIR` from the process environment when present;
- otherwise do not set it, allowing sidecar default `~/.pi/agent`;
- retain explicit test/development override support.

Inspect whether `ZOSMA_DIR` is still needed for unrelated Cowork workspace data. Do not delete unrelated state handling.

### Tests first

1. Rust/relay test verifies `get_onboarding_status` command is registered and forwards correct type.
2. Sidecar spawn/environment test verifies no forced `ZOSMA_PI_AGENT_DIR` in normal production path.
3. Existing isolated tests explicitly set a temporary `ZOSMA_PI_AGENT_DIR` and remain isolated.
4. Status command returns safe error when sidecar is not ready.

Run:

```bash
cargo fmt --check
cargo clippy -- -D warnings
cargo test --workspace
```

### Exit criteria

Existing Pi state is visible to production Cowork; tests still use isolated temporary state; no secret path or content is rendered.

---

## 9. Stage 3 — `useOnboardingStatus` and App Startup Classification

### Goal

Replace the current `hasCredentials`/model-count startup decision with explicit status-driven routing.

### Hook contract

Create `useOnboardingStatus` with:

```ts
interface UseOnboardingStatusResult {
  status: OnboardingStatus | null;
  loading: boolean;
  refresh: () => Promise<void>;
}
```

Behavior:

- query `get_onboarding_status` after sidecar is ready;
- retry transient not-ready failures using existing `useAuth` patterns;
- refresh on `ready` and `config-reload`;
- never expose credentials;
- avoid duplicate listeners under React StrictMode/HMR;
- preserve last known status during a transient refresh failure rather than flashing new-user UI.

### App state machine

Refactor `App.tsx` to derive:

```ts
const isNewUser = status?.hasExistingSetup === false;
const showNewUserConnect = isNewUser && !loading && !skipOnboarding;
const showRouterAnnouncement =
  status?.hasExistingSetup === true &&
  status.zosmaConnected === false &&
  !announcementDismissed;
```

Do not use `models.length > 0` as authentication evidence.

Startup ordering:

```text
sidecar boot
  -> onboarding status
  -> splash ends
  -> new user: HomeView(initialStep="connect")
  -> existing user: normal shell/chat
  -> existing user without Zosma: announcement overlay
```

Keep a loading state when status is unknown. Never flash chat or onboarding based on default `false` before the first status response.

`showConnectModal` remains reachable from Settings/API-key actions, but new-user entry should be explicit and not depend on the old `ZosmaLoginScreen` route.

### New-user completion

After any provider journey succeeds:

1. provider saves/config reloads;
2. refresh onboarding status;
3. confirm at least one usable model exists;
4. dismiss connect screen and enter chat;
5. preserve selected model if valid, otherwise use existing default selection behavior.

If provider setup succeeds but model reload fails, remain on connection UI with retry; do not enter empty chat.

### Tests first

Extend `src/hooks/useOnboardingStatus.test.ts`:

1. loading does not render onboarding or chat;
2. `{ false, false }` renders new-user connect route;
3. `{ true, false }` renders normal chat route plus announcement eligibility;
4. `{ true, true }` renders normal chat with no announcement;
5. refresh on `config-reload` updates route;
6. transient query failure does not flash new-user route;
7. strict-mode listener cleanup does not duplicate requests.

Extend `src/App.telemetry.test.tsx` or add `src/App.onboarding.test.tsx` for DOM routing. Keep current telemetry tests intact.

### Exit criteria

- `ZosmaLoginScreen` is no longer rendered by `App.tsx`.
- New users land on `HomeView` connect step.
- Existing users reach normal shell/chat before any promotional modal.
- Zosma-connected users bypass promotion.

---

## 10. Stage 4 — HomeView Zosma-First Connect Screen

### Goal

Use one professional connection screen with Zosma primary and alternatives expandable.

### Props and structure

Add a focused prop rather than a new component hierarchy:

```ts
interface OnboardingProps {
  initialStep?: "splash" | "connect";
  // existing callbacks remain
}
```

App passes `initialStep="connect"` for the new-user startup route.

Refactor connect content:

1. Keep existing Zosma auth hook/card behavior.
2. Add explicit `More ways to connect` disclosure state.
3. Keep Zosma card visible while alternatives are expanded.
4. Move API-key, custom/local, and third-party OAuth choices inside the expanded alternatives section.
5. Preserve existing provider IDs:
   - `anthropic`;
   - `openai-codex`;
   - `github-copilot`;
   - API-key provider picker;
   - `CustomProviderRow`.
6. Do not replace `ProviderAuthSection` with key entry.
7. Preserve existing `onComplete`, `onSkipToSettings`, `onDismiss`, and subscription behavior.
8. Use accurate copy: `Claude Pro / Max`, `ChatGPT Plus / Pro`, `GitHub Copilot`, `Use an API key`, `Local or custom endpoint`.

### Interaction states

- collapsed: Zosma card + `More ways to connect` button;
- expanded: all alternatives visible;
- third-party selected: existing `ProviderAuthSection` opens inline;
- API key selected: existing provider picker and validation form opens inline;
- local/custom selected: existing `CustomProviderRow` opens inline;
- Zosma waiting: disable alternative controls only while Zosma transaction is active;
- Zosma error: show safe retry while keeping alternatives available;
- Escape/collapse: do not erase completed provider state.

### Visual requirements

- Use existing `glass`/border/radius utilities and tokens.
- Use existing `zosma-mark.png` logo.
- Use no ASCII art in production UI.
- Use visible focus styles and semantic disclosure state (`aria-expanded`, `aria-controls`).
- Use reduced-motion-safe transitions or no transition.
- Avoid new inline token styles; migrate nearby new styles to Tailwind utilities.

### Tests first

Add tests before markup changes:

1. `HomeView` with `initialStep="connect"` skips splash.
2. Zosma card renders first.
3. `More ways to connect` is collapsed initially.
4. Disclosure reveals Claude, ChatGPT, Copilot, API key, and local/custom choices.
5. Claude/ChatGPT/Copilot render `ProviderAuthSection`, not API-key input.
6. API-key choice opens existing key form.
7. Custom/local choice opens existing custom provider UI.
8. Collapsing does not remove saved provider state.
9. Zosma waiting disables alternatives and exposes Cancel.
10. Zosma error preserves alternatives and Retry.
11. Keyboard disclosure and focus behavior works.

Run:

```bash
npm test -- HomeView
npm run lint
npm run typecheck
```

### Cleanup

After App no longer imports `ZosmaLoginScreen`, delete the duplicate component and its obsolete test, unless another caller is found by grep. Verify no imports remain before deletion.

---

## 11. Stage 5 — Existing-User Announcement Modal

### Goal

Show one branded, non-blocking Router release announcement after splash for eligible existing users.

### Component

Create `src/components/ZosmaRouterAnnouncement.tsx` using existing `Dialog`.

Props:

```ts
interface ZosmaRouterAnnouncementProps {
  open: boolean;
  phase: ZosmaAuthPhase;
  error?: string | null;
  onStartTrial: () => void;
  onCancelAuth: () => void;
  onDismiss: () => void;
}
```

If `useZosmaAuth` ownership is cleaner in the component, document why. Preferred: App owns auth lifecycle or passes the existing hook callbacks so the modal and HomeView do not start two simultaneous transactions.

### Content

Required visible content:

- Zosma mark/logo;
- `Zosma AI Router is here`;
- Mimo v2.5;
- DeepSeek V4 Flash;
- GPT-5.6 Luna;
- GPT-5.6 Terra;
- `100 free requests every day`;
- `Start free trial`;
- `Not now`.

Model copy is marketing only. Never construct fallback model entries from these strings.

### Dismissal persistence

Use one versioned local storage key:

```ts
const ZOSMA_ROUTER_ANNOUNCEMENT_VERSION = "v1";
const ZOSMA_ROUTER_ANNOUNCEMENT_KEY =
  `zosma-router-announcement-${ZOSMA_ROUTER_ANNOUNCEMENT_VERSION}`;
```

Store only a boolean/version marker. Do not store auth status, user identity, device ID, key, or URL.

Rules:

- read safely when storage is unavailable or malformed;
- `Not now` marks current version dismissed and closes;
- Escape/backdrop close must have the same dismissal semantics if treated as “Not now”; otherwise make dismissal behavior explicit and test it;
- successful Start Trial closes only after auth completion and model reload;
- auth error leaves modal open with retry and `Not now` available;
- later campaign version uses a new key.

### Visual/accessibility

- Use `Dialog` with `role="dialog"`, `aria-modal`, labelled heading, and focus behavior from primitive.
- Brand-blue background must use existing token utilities/gradient classes, not hard-coded hex.
- White text must meet contrast on brand surface.
- CTA uses existing primary button treatment.
- Secondary `Not now` is visually quieter but keyboard-visible.
- Preserve dark/light theme behavior and reduced-motion behavior.
- Keep content compact enough for narrow desktop/mobile windows.

### Tests first

Create `ZosmaRouterAnnouncement.test.tsx`:

1. closed modal renders nothing;
2. open modal renders all required copy and logo alt;
3. `Start free trial` calls auth start callback;
4. waiting state shows browser instruction and Cancel;
5. error state shows safe retry text and does not show raw backend details;
6. `Not now` calls dismissal and writes only version marker;
7. reopening same version after dismissal renders nothing;
8. storage read/write failures do not crash or block auth;
9. Escape/backdrop uses documented dismissal behavior;
10. no credential-like values appear in rendered DOM or storage payload;
11. focus/accessible name behavior remains valid.

Run focused test before implementation and confirm failure.

---

## 12. Stage 6 — App Announcement Eligibility and Auth Handoff

### Goal

Wire modal into existing-user startup without blocking chat or duplicating Zosma auth transactions.

### App behavior

1. Compute announcement eligibility only after onboarding status is known.
2. Require:
   - `hasExistingSetup === true`;
   - `zosmaConnected === false`;
   - current announcement version not dismissed;
   - normal app shell/chat is ready enough to display the modal.
3. Do not show modal for a new user; they use HomeView Zosma card.
4. Do not show modal for connected Zosma users.
5. Do not hide sidebar/chat behind a full-screen login route.
6. Start Trial invokes existing `start_zosma_auth` through `useZosmaAuth`.
7. On success, wait for `config-reload`, refresh status/models, verify usable model, then close modal.
8. On cancel/error, leave existing chat and providers untouched.
9. While modal auth is pending, prevent a second Zosma start from Settings or HomeView. Use one in-flight guard, not duplicated transaction state.
10. If the user opens Settings while announcement is visible, close or keep modal according to normal dialog semantics; never lose a pending transaction.

### Tests first

Add App integration tests with mocked status/auth:

1. existing/no-Zosma renders chat plus announcement;
2. existing/Zosma connected renders chat without announcement;
3. new/no-Zosma renders HomeView connect and no announcement;
4. dismissed version suppresses announcement;
5. Start Trial begins existing Zosma auth;
6. successful completion refreshes status and closes modal only after usable models;
7. auth failure keeps modal and chat/providers intact;
8. Not now leaves chat usable and settings route available;
9. duplicate config-reload/ready events do not duplicate announcement or auth completion.

### Exit criteria

All four startup classifications in the spec are represented by tests.

---

## 13. Stage 7 — Settings Ordering and Connected State

### Goal

Make Zosma Router the first Authentication option without changing provider lifecycle behavior.

### Changes

In `src/components/settings/Authentication.tsx`:

1. Render `ZosmaStatus` first.
2. Render OAuth `PROVIDERS_CONFIG` rows next.
3. Render API key row next.
4. Render `CustomProviderRow` last.
5. Keep refresh/listener behavior unchanged.
6. Pass `authStatus` safely when loading (`null` should not crash `ZosmaStatus`).
7. Keep Zosma visible in disconnected state.

Do not reorder or rewrite provider IDs. Do not expose managed `zosmaai-router` in generic API-key/custom-provider lists.

### Tests first

Extend `Authentication.test.tsx`:

1. Zosma appears before Claude/ChatGPT/Copilot/API key/custom provider in DOM order.
2. Zosma disconnected row shows Connect.
3. Zosma connected row retains usage/refresh/disconnect behavior.
4. Existing OAuth rows remain present and functional.
5. Custom provider row remains present and functional.
6. `config-reload` refreshes all status without duplicate listeners.

Use DOM order assertions against accessible labels, not implementation class names.

---

## 14. Stage 8 — Styling, Security, and Regression Hardening

### Styling checks

Run:

```bash
npm run lint:styles
npm run lint
npm run typecheck
```

Fix only styles touched by this feature. Do not increase inline token-style baseline. Verify light and dark themes manually or through existing theme tests.

### Security checks

Search changed files for accidental secret handling:

```bash
grep -RniE 'access_token|refresh_token|code_verifier|device_key|authorization_code|apiKey' \
  src/components src/hooks src/App.tsx
```

Review each match. Labels/types are allowed; values must not be rendered or persisted.

Verify:

- announcement local storage contains only version dismissal;
- Zosma auth hook still owns only non-secret phase/error/result;
- no full authorization URL is included in telemetry/error text;
- modal retry does not invoke a second exchange for the same deep link;
- unrelated providers survive Zosma failure/disconnect.

### Regression checks

- provider OAuth browser/device flows still open once;
- Copilot device code remains visible where existing flow requires it;
- API-key validation and provider picker tests pass;
- custom local endpoint save/discovery remains functional;
- `has_credentials` callers not migrated yet remain compatible;
- normal chat and session loading do not depend on Zosma availability;
- `models.length === 0` no longer overrides explicit onboarding status into an incorrect route.

---

## 15. Stage 9 — Full Validation

Run from repository root:

```bash
npm run lint
npm run lint:styles
npm run typecheck
npm test
npm run build:frontend
```

Run sidecar:

```bash
cd agent-sidecar
npx tsc --noEmit
npm test
npm run build
```

Run Tauri:

```bash
cd src-tauri
cargo fmt --check
cargo clippy -- -D warnings
cargo test --workspace
```

### Focused test list

At minimum, focused tests must include:

```bash
npm test -- HomeView ZosmaRouterAnnouncement useOnboardingStatus Authentication App
cd agent-sidecar && npm test -- onboarding-status
cd ../src-tauri && cargo test
```

If the repository's test runner does not accept these file filters, use its documented equivalent rather than changing test tooling.

### Manual acceptance matrix

| Scenario | Expected result |
|---|---|
| Fresh state: no auth/config | HomeView connect, Zosma first, alternatives collapsed |
| Fresh state: click More ways | All five alternatives appear |
| Fresh state: Claude | Existing Claude OAuth journey |
| Fresh state: ChatGPT | Existing ChatGPT/OpenAI Codex OAuth journey |
| Fresh state: Copilot | Existing GitHub device/OAuth journey |
| Fresh state: API key | Existing provider picker and validation |
| Fresh state: local/custom | Existing endpoint/model flow |
| Existing auth user, no Zosma | Chat plus announcement |
| Existing models/custom-only user, no Zosma | Chat plus announcement |
| Existing user clicks Not now | Chat continues; same version does not return |
| Existing user clicks Start free trial | Browser auth, catalog refresh, modal closes after usable model |
| Existing user already connected Zosma | Chat, no announcement |
| Zosma auth canceled | Chat/onboarding remains usable; no provider changes |
| Zosma auth fails | Safe retry; unrelated providers untouched |
| Zosma disconnected in Settings | Zosma remains first and offers Connect |
| App restart after dismissal | Current announcement version remains dismissed |
| New announcement version | New version can display |

---

## 16. Suggested Commit/Review Boundaries

Do not commit or push until requested. When implementation is eventually approved, keep changes reviewable in these logical groups:

1. `test: define onboarding status and startup classifications`
2. `feat: expose explicit onboarding status and normal Pi state`
3. `feat: route new users through Zosma-first HomeView connect`
4. `feat: add Zosma Router release announcement`
5. `feat: put Zosma Router first in authentication settings`
6. `test: cover provider-preserving onboarding journeys`

If repository workflow requires fewer commits, preserve these boundaries in the PR description.

---

## 17. Definition of Done

Implementation is complete only when:

- [ ] Spec behavior and all four startup classifications pass tests.
- [ ] No normal startup path renders `ZosmaLoginScreen`.
- [ ] New users land in `HomeView` connect with Zosma first.
- [ ] `More ways to connect` exposes all existing provider journeys.
- [ ] OAuth subscription options remain OAuth/device flows.
- [ ] Existing users receive one versioned, dismissible branded announcement.
- [ ] Start Trial uses existing secure Zosma auth and closes only after catalog/model verification.
- [ ] Zosma-connected users see no announcement.
- [ ] Settings renders Zosma first.
- [ ] Production Cowork no longer forces a private Pi state directory.
- [ ] Explicit test state override still works.
- [ ] Existing providers and chat history survive every Zosma failure/disconnect path.
- [ ] No secret values enter renderer state, storage, telemetry, logs, or errors.
- [ ] Frontend lint, style lint, typecheck, tests, and build pass.
- [ ] Sidecar typecheck, tests, and build pass.
- [ ] Rust fmt, clippy, and workspace tests pass.
- [ ] Manual acceptance matrix passes on a fresh profile and an existing profile.

---

## 18. Explicit Non-Goals

Do not add during this implementation:

- a new auth backend or provider protocol;
- a second Zosma login screen;
- hard-coded Zosma model configuration;
- automatic migration or deletion of existing provider credentials;
- forced Zosma login for existing users;
- billing/payment UI;
- ASCII art in production UI;
- a new persistence layer beyond versioned dismissal marker;
- a new state-management dependency;
- task branches or pushed subagent work.
