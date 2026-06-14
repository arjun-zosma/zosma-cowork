# Google Workspace App — configurable scopes + bring-your-own client (#281)

**Date:** 2026-06-14
**Status:** Plan (pre-implementation)
**Issue:** https://github.com/zosmaai/zosma-cowork/issues/281
**Worktree:** `.worktrees/281-google-workspace-app` (branch `feat/281-google-workspace-app`, off `main`)

---

## 0. Framing — "Google Workspace" as an App

Cowork already models **Apps** (`src/components/settings/Apps.tsx`): an app
bundles the extensions + skills + credentials a real workflow needs, with a
one-click setup. "Google Workspace" is the first app — today it brokers ONE
OAuth consent for a fixed UNION of scopes and fans tokens out to the pi config
files each extension reads (`agent-sidecar/src/google-auth/broker.ts`).

This issue makes that app's **config UI real**: granular per-product scope
selection + bring-your-own OAuth client. It is the **auth/scope/consent layer +
UI only** — NOT new Gmail/Drive/Docs tools (issue non-goal).

> An "app" = packaged extensions + skills + an external config/OAuth flow that
> writes the correct pi config. Under the hood it is just the pi coding agent,
> so once the tokens land in pi's dirs every extension works unchanged.

## 1. Reconciliation with the pi-native principle (important)

The in-flight `feat/pi-native-resources` branch establishes the rule:

> **If pi has a concept for it, pi owns it** (read/write through pi dirs).
> `~/.zosmaai/cowork/` is reserved ONLY for zosma-specific data pi has no
> concept of.

Applying this resolves issue #281 §5's open question cleanly:

| Data | Owner | Path | Why |
|---|---|---|---|
| OAuth tokens (access/refresh) | **pi** | `~/.pi/agent/google-workspace/oauth.json`, `settings.json["pi-gmail"]`, `db/gmail-tokens.json` | pi extensions read+refresh these — unchanged from today |
| Granted scopes | **pi** | embedded in the token files' `scope` field | pi already stores it |
| **Scope prefs** (what the user selected to request) | **Cowork** | `~/.zosmaai/cowork/google-workspace/scope-prefs.json` | a consent-UI preference; pi has no concept of "which scopes to ask for" |
| **BYO client id/secret** (broker input) | **Cowork** | `~/.zosmaai/cowork/google-workspace/byo-client.json` (0600) | input to Cowork's consent broker; pi only ever reads the resulting oauth.json |

Net: tokens stay pi-native (no change); only the two **Cowork-broker inputs**
(scope prefs + BYO creds) live under `~/.zosmaai/cowork/`. This does NOT touch
`extension-manager.ts`, so it runs in parallel with `pi-native-resources` with
no merge conflict (only shared concept is the storage policy, which we honour).

## 2. Scope model — capability matrix

Replace the flat `GOOGLE_SCOPES` map with a per-product capability matrix
(`agent-sidecar/src/google-auth/scopes.ts`, new pure module):

```
Drive:    off | file(drive.file) | read(drive.readonly) | full(drive)
Gmail:    off | read(gmail.readonly) | send(gmail.send) | compose(gmail.compose)
          | modify(gmail.modify) | full(https://mail.google.com/)
Calendar: off | read(calendar.readonly) | full(calendar)
Docs:     off | read(documents.readonly) | full(documents)
Sheets:   off | read(spreadsheets.readonly) | full(spreadsheets)
Slides:   off | read(presentations.readonly) | full(presentations)
Identity: always openid email profile
```

- Each capability carries a **tier** (`recommended | sensitive | restricted`)
  for honest "unverified app" warnings in the UI.
- `resolveScopes(prefs): string[]` → identity scopes + each selected product's
  capability scope(s). Pure + unit-tested.
- **Default preset = "Full access"** (every product at full) → preserves exact
  current behaviour and the one-click connect.

## 3. Consent + broker changes (`broker.ts` / `consent.ts`)

- `runConsent` takes a **resolved scope list** (from prefs) instead of importing
  `UNION_SCOPES`. Keep `UNION_SCOPES` as the "Full access" preset value.
- After consent, **diff requested vs granted** (Google may grant fewer). Store
  granted scope per product (already derivable via `productsFromScope`, extend
  to capability level). Drives status UI + tool gating.
- Re-consent uses `prompt=consent` when the selection broadens (already always
  set today — keep, it is required to receive a refresh_token).
- `fanOutCredentials`: only write destinations for **selected** products —
  skip `gmail-tokens.json` + `pi-gmail` settings when Gmail capability = off;
  skip workspace `oauth.json` only-product writes accordingly. Identity always
  present so email resolves.
- `embeddedClient()` precedence: **BYO client → env (`ZOSMA_GOOGLE_*`) →
  build-baked Zosma client**. When BYO is set, the device holds the secret and
  refresh/exchange go direct (not via broker) — mirror the legacy direct path.

## 4. UI (`GoogleIntegration.tsx`)

- Default **Connect** button = Full access (unchanged one-click).
- **Advanced** disclosure: per-product capability radios (Off allowed) + a live
  "scopes Google will ask for" summary + tier badges (restricted/sensitive).
- **Use my own client** toggle → client id + secret fields + helper link to
  create a Desktop/Web OAuth client and enable the APIs.
- Connected state: account email, per-product **granted** capability, Disconnect
  (revoke + clear written destinations — extend `disconnectGoogle` to clear BYO
  + scope-pref files too on full disconnect).
- Persist selection so reconnect/refresh reuses it; show granted-vs-requested.

## 5. Sidecar command surface (`index.ts`)

- `connect_google` payload gains optional `prefs` (scope selection) + `byo`
  (client id/secret). Persist prefs/BYO before consent; pass resolved scopes to
  `runConsent`; only fan out selected destinations.
- `get_google_status` returns granted capabilities (per product) + requested
  prefs + whether BYO is in use + tiers, so the UI can render the diff.
- New `save_google_prefs` / `get_google_prefs` (or fold into connect) for the
  Advanced panel to persist without immediately re-consenting.
- Rust: add matching `#[tauri::command]` passthroughs in `src-tauri/src/lib.rs`
  mirroring `google_connect`/`google_get_status`/`google_disconnect`.

## 6. TDD order (pure-first, matches existing `broker.test.ts` style)

1. `scopes.ts` + `scopes.test.ts` — capability matrix, `resolveScopes`, tiers,
   "Full access" preset == today's `UNION_SCOPES`.
2. Scope-prefs + BYO store (read/write/clear under `~/.zosmaai/cowork/...`,
   0600) + tests (temp HOME, like `broker.test.ts`).
3. `fanOutCredentials` selective-destination tests (Gmail off ⇒ no gmail files).
4. `embeddedClient()` BYO precedence test.
5. `runConsent` resolved-scope wiring (scope list comes from prefs) — keep the
   network bits injected/mocked as today.
6. `googleStatus` granted-capability diff test.
7. Wire `index.ts` handlers + Rust commands (typecheck-driven).
8. `GoogleIntegration.tsx` Advanced + BYO UI (component, manual verify).

## 7. Acceptance criteria (from #281) — STATUS

- [x] Default one-click connect = full access (`DEFAULT_PREFS` resolves to exactly
      today's `UNION_SCOPES`; unit-tested).
- [x] Advanced per-product capability selection drives the actual consent scopes
      (`resolveScopes` → `runConsent({ scopes })`).
- [x] Granted-vs-requested scopes stored and shown in status UI
      (`grantedCapabilities`, `googleStatus.granted`/`requested`).
- [x] BYO client id/secret supported with documented precedence
      (`embeddedClient(byo)`: BYO → env → baked; direct Google exchange).
- [x] Disconnect revokes + clears all written destinations (+ BYO + prefs).
- [x] `fanOutCredentials` only writes destinations for selected products.
- [x] Scope prefs + BYO live under `~/.zosmaai/cowork/` (pi-native principle);
      tokens stay in pi dirs.

All on branch `feat/281-google-workspace-app`. Verification: 41 google-auth
unit tests + 185 sidecar tests green; `tsc --noEmit` clean (sidecar + frontend);
`cargo check` clean; esbuild bundle clean; SettingsPage tests green; style
guardrail ratcheted. **Pending: manual end-to-end consent run + screenshots.**

## 8. Out of scope

- Google app verification / CASA (tracked separately).
- New Gmail/Drive/Docs/Sheets/Slides tool extensions.
- The pi-native extension/skill registry refactor (separate branch).
