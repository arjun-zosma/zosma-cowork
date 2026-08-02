# Zosma Router Onboarding and Release Announcement

> Status: Draft
> Scope: Cowork startup classification, Zosma-first connection UI, existing-user Router announcement, and Authentication settings ordering.
> Related: [Zosma Router Auth Integration](2026-07-28-zosma-router-auth-integration-design.md)

---

## 1. Goal

Make Zosma AI Router the clearest first connection path without hiding established Pi authentication journeys.

- **New users** get one polished `HomeView` connection screen with Zosma as the primary choice and expandable alternatives.
- **Existing Pi users** enter Cowork normally, then receive a one-time release announcement that can start Zosma authentication.
- **Zosma-connected users** enter Cowork without a promotion modal.
- Settings always expose **Zosma AI Router first**, before other providers.

Zosma authentication is additive. It must never replace, revoke, or block Claude, ChatGPT, Copilot, API-key, custom-endpoint, or local-model setups.

---

## 2. Definitions and Startup State

### 2.1 Existing user

An existing user has at least one usable, user-configured Pi setup:

- a saved OAuth or API-key provider;
- a saved custom endpoint or local-model provider; or
- saved model configuration in Pi state.

A runtime model catalog alone does **not** make someone existing. Extensions can register catalog entries without any user configuration.

A new user has none of the above. An empty file created by initialization does not count as configured state.

### 2.2 Required status contract

Do not overload `has_credentials`. It means authenticated provider credentials and remains useful for existing provider logic, but it cannot identify local/custom users configured only through models.

Startup needs a separate, non-secret status:

```ts
interface OnboardingStatus {
  hasExistingSetup: boolean;
  zosmaConnected: boolean;
}
```

`hasExistingSetup` is computed from configured Pi state, not from the runtime registry model count. `zosmaConnected` is true only when managed provider `zosmaai-router` is configured and usable.

Production Cowork reads normal Pi state at `~/.pi/agent` so existing Pi users are recognized. `ZOSMA_PI_AGENT_DIR` remains an explicit developer/test override only; Cowork must not force it in production.

### 2.3 Startup decision table

| Existing Pi setup | Zosma connected | Result after splash |
|---|---:|---|
| No | No | `HomeView` connection screen, Zosma-first |
| Yes | No | Chat plus one-time Zosma Router announcement |
| Yes | Yes | Chat with no announcement |
| No | Yes | Chat; defensive case only |

If setup is incomplete or no usable model is available, do not open chat. Keep the relevant connection UI visible with an actionable error.

---

## 3. User Journeys

### 3.1 New user: Zosma Router

```text
[Splash]
    |
    v
[HomeView: Connect your AI]
    |
    +-- Continue with Google
    |      |
    |      v
    |   [System browser: Zosma Google sign-in]
    |      |
    |      v
    |   [Deep link returns to Cowork]
    |      |
    |      v
    |   [Authenticated catalog refresh + model selection]
    |      |
    |      v
    +--> [Chat]
```

The primary action uses the existing secure Zosma device-authorization flow: system browser, PKCE, state, deep link, scoped router key, authenticated catalog, then model refresh. The renderer never receives a router key, Google token, code verifier, or authorization code.

### 3.2 New user: other provider

```text
[HomeView: Connect your AI]
    |
    +-- More ways to connect
            |
            v
      [Expanded provider choices]
            |
            +-- Claude Pro / Max      -> existing provider OAuth journey
            +-- ChatGPT Plus / Pro    -> existing provider OAuth journey
            +-- GitHub Copilot        -> existing provider OAuth journey
            +-- API key               -> provider picker, validation, save
            +-- Local/custom endpoint -> endpoint and model configuration
            |
            v
      [Provider configuration succeeds]
            |
            v
      [Config reload + usable model verification]
            |
            v
          [Chat]
```

This is not an API-key-only fallback. Every item preserves its existing provider-specific journey:

| Choice | Required journey |
|---|---|
| Claude Pro / Max | Existing subscription OAuth/device flow. Browser or device authorization remains provider-owned; Cowork refreshes auth status after completion. |
| ChatGPT Plus / Pro | Existing OpenAI/Codex OAuth journey. Do not replace it with an API-key form. |
| GitHub Copilot | Existing GitHub OAuth/device journey and organization/account selection where currently required. |
| API key | Existing provider picker, format guidance, live validation when available, then local save. |
| Local/custom endpoint | Existing custom-provider flow: endpoint, protocol/model configuration, and no fake credential requirement for local servers. |

A failed, cancelled, or unsupported third-party flow leaves the expanded choices open and shows provider-safe retry guidance. It never drops the user into an empty chat screen.

### 3.3 Existing Pi user: Router release announcement

```text
[Splash]
    |
    v
[Chat + Zosma Router announcement]
    |
    +-- Start free trial -> Zosma browser auth -> catalog refresh -> Chat
    |
    +-- Not now ---------> dismiss announcement -> Chat
                                  |
                                  v
                     [Settings > Authentication > Zosma AI Router]
```

The announcement is shown only when `hasExistingSetup` is true, `zosmaConnected` is false, and the user has not dismissed the current announcement version. It is promotional, never a blocker. A user can continue working immediately.

### 3.4 Existing Pi user: settings

```text
Settings > Authentication

+--------------------------------------------------+
| Zosma AI Router                        Connect   |  <- first
| 4 Zosma models · 100 free requests every day     |
+--------------------------------------------------+
| Claude Pro / Max                       Connected |
| ChatGPT Plus / Pro                     Connected |
| GitHub Copilot                         Connected |
| API keys                                         |
| Local / custom providers                         |
+--------------------------------------------------+
```

When connected, the Zosma row retains its existing usage, refresh-models, reconnect, and disconnect controls.

---

## 4. New-User Connection Screen

Reuse `HomeView`. Do not create a separate Zosma login page.

```text
+--------------------------------------------------+
|                                                  |
|                 [ Zosma logo ]                   |
|                                                  |
|                 Connect your AI                  |
|       Choose Zosma or another provider.          |
|                                                  |
|  +--------------------------------------------+  |
|  | ZOSMA AI ROUTER              RECOMMENDED   |  |
|  |                                            |  |
|  | Four capable models.                       |  |
|  | 100 free requests every day.               |  |
|  |                                            |  |
|  |       [ Continue with Google ]             |  |
|  +--------------------------------------------+  |
|                                                  |
|              -------- or --------                |
|                                                  |
|          [ More ways to connect  v ]              |
|                                                  |
+--------------------------------------------------+
```

### 4.1 Expanded alternatives

The secondary control expands in place; it does not navigate to a second onboarding screen. This keeps Zosma visible as the preferred choice while making alternatives discoverable and equal in capability.

```text
+--------------------------------------------------+
|          [ More ways to connect  ^ ]              |
|                                                  |
|  +--------------------------------------------+  |
|  | [Claude]     Claude Pro / Max              |  |
|  |              Sign in with your subscription |  |
|  +--------------------------------------------+  |
|  | [OpenAI]     ChatGPT Plus / Pro            |  |
|  |              Sign in with your account      |  |
|  +--------------------------------------------+  |
|  | [GitHub]     GitHub Copilot                 |  |
|  |              Connect your Copilot account   |  |
|  +--------------------------------------------+  |
|  | [Key]        Use an API key                 |  |
|  |              Select provider and validate   |  |
|  +--------------------------------------------+  |
|  | [Server]     Local or custom endpoint       |  |
|  |              Ollama, LM Studio, or OpenAI   |  |
|  +--------------------------------------------+  |
+--------------------------------------------------+
```

Selecting a subscription item opens that provider's existing auth UI in the expanded area. Selecting API key or custom endpoint opens the existing forms in the same area. The user can return to the collapsed list without losing a completed connection.

### 4.2 Interaction states

| State | Primary card behavior |
|---|---|
| Idle | `Continue with Google` enabled; alternatives may expand. |
| Starting | Button disabled with “Opening Google sign-in…”. |
| Waiting for browser | “Complete sign-in in your browser” plus `Cancel`. Alternatives are disabled only while Zosma transaction is pending. |
| Completing | “Loading your models…”. |
| Error | Clear safe error, `Try again`; expanded alternatives remain available. |
| Complete | Refresh configuration, verify a usable model, then enter chat. |

---

## 5. Existing-User Announcement

### 5.1 Content

```text
+--------------------------------------------------+
| [Zosma logo]                                     |
|                                                  |
| ZOSMA AI ROUTER IS HERE                          |
|                                                  |
| One connection. Four Zosma models.               |
| Mimo v2.5 · DeepSeek V4 Flash                    |
| GPT-5.6 Luna · GPT-5.6 Terra                     |
|                                                  |
| 100 free requests every day.                     |
|                                                  |
|          [ Start free trial ]                    |
|                 Not now                          |
+--------------------------------------------------+
```

The model names are marketing copy, not a client-side entitlement fallback. Post-login models always come from the authenticated catalog; unavailable models are never written to Pi configuration.

### 5.2 Behavior

- `Start free trial` starts existing Zosma auth from the modal.
- Success closes modal only after catalog refresh and usable-model verification.
- Browser cancellation or auth error keeps modal open with retry; `Not now` remains available.
- `Not now` dismisses only this announcement version. The settings row remains available.
- Store dismissal locally with a versioned key, for example `zosma-router-announcement-v1`. A later deliberate campaign version can use a new key.
- Do not record authentication state, account identity, or any credential in announcement storage.

### 5.3 Visual design

Use Cowork's existing visual system from `docs/DESIGN.md`:

- `panel-raised`/`glass` structure, rounded `2xl` surface, backdrop blur, brand shadow, and visible focus treatment.
- `brand-gradient` / existing `--brand` and `--brand-2` tokens for Zosma blue. Do not add hard-coded hex or a new color system.
- Brand-blue announcement surface with white foreground text, Zosma mark, strong primary CTA, and restrained secondary text action.
- Respect light and dark themes, `prefers-reduced-motion`, keyboard focus, Escape dismissal, and labelled buttons.
- Keep copy concise. No ASCII art in production UI; the logo and typography are the brand treatment.

---

## 6. Settings Requirements

`Settings > Authentication` order is fixed:

1. Zosma AI Router
2. OAuth subscription providers
3. API key management
4. Local/custom providers

The Zosma row is visible whether connected or not. Disconnected state offers `Connect`; connected state shows non-secret account status, usage, refresh, reconnect, and disconnect actions.

Existing provider rows retain their current auth lifecycle. Reordering must not alter their saved credentials, buttons, or disconnect semantics.

---

## 7. Failure and Edge Cases

| Case | Required behavior |
|---|---|
| No saved auth/models | Show `HomeView`; never show release announcement. |
| Models-only/local-custom setup | Treat as existing; show chat and announcement. |
| Auth-only setup but model refresh pending | Treat as existing; do not show new-user onboarding. Keep a non-chat loading/error state until a usable model exists. |
| Existing user dismisses announcement | Enter chat; do not show same announcement version again. |
| Existing user disconnects Zosma | Settings immediately offers reconnect. Do not re-show dismissed announcement. |
| Zosma auth fails | Preserve every unrelated provider and selected model; show retry. |
| Third-party OAuth fails/cancels | Preserve expanded alternatives and provider-specific retry path. |
| API key validation fails | Keep key form open; do not erase user input unless user cancels. |
| Local/custom provider has no credential | Accept valid configured local provider as existing setup; do not require `auth.json`. |
| No entitled Zosma models | Explain account has no Zosma models; do not save fallback models. |

---

## 8. Acceptance Tests

### Startup and UI

1. No configured auth or models opens Zosma-first `HomeView`.
2. Zosma card appears before collapsed `More ways to connect` control.
3. Expanding alternatives shows Claude, ChatGPT, Copilot, API key, and local/custom choices.
4. Each subscription choice starts its existing provider-specific auth journey, not API-key entry.
5. API key and custom/local choices preserve their existing forms and validation.
6. Models-only user is classified as existing and receives announcement, not new-user onboarding.
7. Authenticated Pi user is classified as existing and receives announcement, not new-user onboarding.
8. Zosma-connected user sees neither onboarding nor announcement.
9. Existing user selecting `Not now` sees chat and no repeat for current version.
10. Existing user selecting `Start free trial` completes Zosma auth, refreshes models, and closes announcement.
11. Zosma is first in Settings > Authentication in connected and disconnected states.

### Regression and accessibility

12. Existing OAuth, API-key, custom endpoint, and local-model flows remain functional.
13. No provider credential, router key, OAuth code, verifier, or account identity appears in DOM, local storage, logs, analytics, or errors.
14. Announcement and expanded controls are keyboard operable, show visible focus, have accessible names, and respect reduced motion.
15. Visual tests cover light and dark themes and existing token-style guardrails.

---

## 9. Out of Scope

- Changing third-party provider protocols or their account entitlements.
- Copying credentials between providers.
- Hard-coding Zosma catalog entries into `models.json`.
- Blocking existing users from chat until they authenticate with Zosma.
- Billing or purchase flow inside Cowork.
