# Live Browsing UX — Showing Real Browsing to the User

> How we make agentic browsing **legible and trustworthy**: the user always knows
> *which browser/session* is in use, *what site* the agent is on, *what it's doing*,
> and can *take over* in one click. Builds on the Phase 1 live viewport + the
> authenticated-browsing strategy.
>
> **North star:** the user should never feel a black box is acting as them. Every
> action is mirrored, narrated, and interruptible.

---

## Three pillars

1. **Identity & trust** — surface *what we're dealing with*: which browser, which
   profile/login, is this a real session or a fresh one, is the connection secure.
2. **Live mirror** — a real-time view of the agent's browser inside the app, with a
   ghost cursor and action highlights so the *action* is visible, not just the result.
3. **Control** — pause/stop, and one-click **take control** for login / CAPTCHA / MFA
   (the handoff pattern), then hand back.

---

## Pillar 1 — Identity & Trust Bar (where browser detection surfaces)

Browser detection isn't a hidden config step — it's a **visible trust signal**. Before
and during a browse, a slim bar tells the user exactly what's happening:

```
┌─────────────────────────────────────────────────────────────────┐
│ 🌐 Using your Chrome · 👤 you@gmail.com · 🔒 mail.google.com      │
│    [ real session ]                              [ ⏸ ] [ ⤢ ] [ ✕ ]│
└─────────────────────────────────────────────────────────────────┘
```

- **Browser chip** — "Using your **Chrome**" / "**Edge**" / "bundled browser". Comes
  straight from detection (see Pillar-1 detection spec below). Icon = the browser's
  real logo so it's instantly recognizable.
- **Identity chip** — "logged in as you@gmail.com" when a real session is detected, or
  "not signed in" for a fresh bundled profile. Tells the user *whose* session is acting.
- **Session-type badge** — `real session` (green) vs `fresh session` (grey). This is
  the single most important trust signal: is the agent *me*, or a clean sandbox?
- **Secure-origin lock** — TLS lock + domain, like a browser address bar.

### Pre-flight picker (first run / ambiguous)
When multiple browsers are detected or it's the first authenticated task, show a small
chooser so the user controls *what we're dealing with*:

```
   How should I browse?
   ┌──────────────────────────────────────────────┐
   │ ◉  Your Chrome      logged in, real session ✅ │  ← recommended
   │ ○  Your Edge        logged in, real session    │
   │ ○  Fresh browser    private, you log in once   │
   └──────────────────────────────────────────────┘
        [ Always use this ]            [ Start ]
```

### Browser detection spec (the data behind the bar)
Detection runs in the **sidecar** at session start (cached), emitting a
`browser:capabilities` event the UI renders. Output shape:

```ts
interface DetectedBrowser {
  id: "chrome" | "edge" | "brave" | "arc" | "opera" | "vivaldi" | "chromium"
     | "firefox" | "safari";
  name: string;              // "Google Chrome"
  family: "chromium" | "firefox" | "webkit";
  tier: 1 | 2 | 3;           // 1=CDP+relay, 2=BiDi, 3=limited/none
  execPath: string;
  version?: string;
  isDefault: boolean;        // OS default browser?
  hasProfile: boolean;       // a real user profile exists?
  channel?: "stable" | "beta" | "dev" | "canary";
}

interface BrowserCapabilities {
  browsers: DetectedBrowser[];
  recommended: DetectedBrowser | null;  // best tier-1, prefer default
  fallback: "bundled-chromium";         // always available
  platform: "win32" | "darwin" | "linux";
}
```

Detection method per platform (all read-only, no launches):
- **Default browser:** `win32` → registry `UserChoice ProgId`; `darwin` →
  `LaunchServices` handler for `http`; `linux` → `xdg-settings get default-web-browser`.
- **Installed set:** probe known install paths + registry/`.app` bundles + `$PATH`.
  - Chromium family: Chrome, Edge (≈universal on Windows), Brave, Arc, Opera, Vivaldi,
    Chromium → **tier 1**.
  - Firefox → **tier 2** (WebDriver BiDi).
  - Safari (darwin only) → **tier 3** (`safaridriver`, limited).
- **Profile presence:** check the browser's user-data dir for a non-empty default
  profile → drives the "real session available" badge.
- Result is cached; a manual "re-detect" refreshes it.

This is what the user asked for — *"important to know what we're dealing with."* The
detection result is both an internal routing decision (which engine/protocol) **and** a
user-facing trust signal (the identity bar).

---

## Pillar 2 — The Live Mirror

We mirror the agent's browser **into the app** (CDP screencast → frames), even when the
engine is the user's *real* Chrome driven over a debug port / extension relay. Watching
inside the app beats watching real windows pop around and steal focus.

### View states (motion `layoutId` morph between them)

```
  minimized chip      PiP (default)          docked            fullscreen
  ┌──────────┐        ┌─────────────┐    ┌──────────────┐   ┌───────────────────┐
  │🌐 browsing│  ←→   │ identity bar │ ←→ │ identity bar │←→ │ identity bar      │
  │ gmail…    │       │┌───────────┐│    │┌────────────┐│   │┌─────────────────┐│
  └──────────┘        ││ live feed ││    ││ live feed  ││   ││   live feed     ││
                      ││  +cursor  ││    ││            ││   ││   (large)       ││
                      │└───────────┘│    │└────────────┘│   │└─────────────────┘│
                      │ ● clicking… │    │ action log → │   │ action timeline → │
                      └─────────────┘    └──────────────┘   └───────────────────┘
```

- **Minimized** — chip in chat (reuses the Phase 0.3 activity chip). Click → PiP.
- **PiP** — floating, draggable, ~360×260, bottom-right. Default when browsing starts.
- **Docked** — pinned side panel for longer tasks; chat + browser side by side.
- **Fullscreen** — Radix dialog overlay; full feed + scrollable action timeline.

### Making the *action* visible (not just the page)
- **Ghost cursor** — a soft pointer animates to the target before a click; a ripple on
  click. The user *sees* the agent move, like watching someone share their screen.
- **Action highlight** — brief outline box over the element being clicked/typed (CDP
  bounding box). Pairs with a label: `● clicking "Compose"`, `● typing subject…`,
  `● reading inbox`.
- **Typing echo** — show characters appearing in the field at human-ish cadence so it
  reads as intentional, not a flash.
- **Scroll/navigate cues** — a thin progress bar on navigation; a subtle scroll
  indicator so jumps don't feel like teleports.

### Privacy in the mirror
- **Auto-mask secrets** — password fields and detected card/SSN inputs render as `••••`
  in the screencast (mask at the frame level before it leaves the engine).
- **Sensitive-site dimming** — on banking/health domains, a "private — masked" ribbon
  and reduced-detail feed unless the user opts to watch in full.
- The mirror is **local-only** — frames never leave the device (consistent with the
  no-cloud-cookies rule).

---

## Pillar 3 — Control & the Handoff

The reliable answer to login / CAPTCHA / MFA isn't to defeat them — it's to **hand the
live browser to the user for a few seconds**.

### Take control
- A persistent **"Take control"** button in the identity bar.
- On click: agent pauses, the live mirror becomes **interactive** (UI events forwarded
  to the engine), cursor switches from ghost → the user's. A banner reads
  *"You're driving — finish the step, then hand back."*
- **Hand back** resumes the agent from where it paused.

### Automatic handoff prompts
When the agent detects a wall it shouldn't cross autonomously:

```
   ┌────────────────────────────────────────────┐
   │ 🔐 Sign-in needed on accounts.google.com    │
   │ I'll pause so you can log in safely.        │
   │            [ I'll do it ]   [ Skip site ]   │
   └────────────────────────────────────────────┘
```

Triggers: login form, CAPTCHA challenge, MFA/OTP screen, consent/cookie wall, or any
**destructive action** (purchase, send, delete) → reuse `confirm-dialog.tsx`.

### Always-available
- **Pause / Resume** and **Stop** in the identity bar, reachable from every view state.
- **Emergency stop** also closes the engine session.

---

## Completion recap

When the task finishes, the chip collapses into a **result card** in chat:

```
   ✅ Done browsing · 4 sites · 38s
   • Found 3 flights under $400 (screenshot)
   • Logged into United as you
   ▸ View action timeline (12 steps)
```

- One-line outcome + key findings, with a thumbnail.
- Expandable **action timeline** (every step, with mini screenshots + timestamps) for
  auditability — what did it actually do *as me*?

---

## Component sketch (frontend)

```
src/components/browser/
  BrowserViewport.tsx        // shell; owns view-state (chip/PiP/docked/fullscreen)
  IdentityBar.tsx            // browser + identity + session badge + lock + controls
  BrowserPreflight.tsx       // "How should I browse?" picker (detection-driven)
  LiveFeed.tsx               // <img>/<canvas> screencast + ghost cursor + highlights
  ActionTimeline.tsx         // step log w/ thumbnails (fullscreen + recap)
  HandoffPrompt.tsx          // login/CAPTCHA/MFA pause cards
  useBrowserStream.ts        // subscribes browser:frame / browser:action / browser:capabilities
```

Events over the existing `session.subscribe` channel:
`browser:capabilities` (detection) · `browser:frame` (screencast) ·
`browser:action` (narration + bbox) · `browser:handoff` (pause request) ·
`browser:done` (recap).

---

## Phasing impact

- **Phase 1** — live mirror (PiP/fullscreen) + action narration + ghost cursor.
- **Phase 1.5** — Identity/Trust bar + **browser detection** + pre-flight picker
  (this is where "know what we're dealing with" ships, and it gates real-session work).
- **Phase 2** — Take control + automatic handoff prompts + completion recap +
  secret-masking in the mirror.

Recommended first build: **detection + Identity bar + a static PiP frame**, so the user
can *see what we're dealing with* before we wire the full screencast.
