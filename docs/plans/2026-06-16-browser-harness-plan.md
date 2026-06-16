# Browser Harness — Phased Plan + Live View UX

> Companion to [`2026-06-16-browser-harness-research.md`](./2026-06-16-browser-harness-research.md). This is the *how we ship it* doc.
> Principle: ship a useful slice fast, then layer complexity. Each phase is independently valuable.

---

## Guiding Principles

1. **Start headless + text, end with a live interactive viewport.** Don't block the agent loop on the UI.
2. **Reuse what exists** — the sidecar already streams events to the UI via `session.subscribe`. Browser events ride the same channel.
3. **Accessibility tree first, pixels later.** The agent reasons on text; the *human* gets the pixels (the live view is for the user, not the LLM).
4. **Every phase ships.** No phase depends on a future phase to be useful.

---

## Technical Spine

```
┌─────────────────────────────────────────────────────────────┐
│  Tauri App (React UI)                                        │
│  ┌──────────────┐         ┌─────────────────────────────┐   │
│  │ Chat / Agent │         │  Browser Viewport (PiP)     │   │
│  │   stream     │◄────────┤  <img>/<canvas> ← frames    │   │
│  └──────┬───────┘  events └─────────────────────────────┘   │
│         │ session.subscribe (existing channel)              │
└─────────┼───────────────────────────────────────────────────┘
          │
   ┌──────▼────────────┐      CDP screencast frames (base64 JPEG)
   │  agent-sidecar    │◄───────────────────────────┐
   │  (Node, pi-agent) │                            │
   │  browser tools ───┼──► agent-browser (Rust) ──► Chromium (headless)
   └───────────────────┘      CDP: navigate/click/    │
                              type/snapshot/screencast │
                                                       │
   The LLM gets: accessibility-tree text snapshots
   The human gets: live JPEG frames (Page.startScreencast)
```

**Why this split matters:** the LLM never sees the screencast (saves tokens). The screencast is a pure UX feed for the human, streamed in parallel and throttled to ~5–8 fps.

---

## Phase 0 — "It works, headless" (MVP, no live view)

**Goal:** Agent can browse and return results. Zero UI beyond a status chip.

- Bundle **agent-browser** (Rust) as a Tauri sidecar binary.
- Register a small tool set as a pi extension (`tools: [{name, description}]`):
  - `browser_navigate(url)`
  - `browser_snapshot()` → accessibility tree text
  - `browser_click(ref)` / `browser_type(ref, text)`
  - `browser_extract(query)` → returns relevant text
  - `browser_close()`
- Headless Chromium. Ephemeral session (no persisted auth yet).

**UX in Phase 0:** just an inline **activity chip** in the chat stream:
> 🌐 Browsing `example.com` → reading results…

**Ship criteria:** ask "research X and summarize" → agent navigates, extracts, answers.

---

## Phase 1 — "The little screen" (Live View PiP) ⭐ the UX you described

**Goal:** A small floating viewport showing the agent's browser live, enlargeable/minimizable.

### Mechanism
- Enable CDP `Page.startScreencast` (JPEG, quality ~60, throttled 5–8 fps, max ~640px wide).
- Sidecar forwards frames as a new event type (`browser:frame`) over the existing `session.subscribe` channel.
- React renders frames into an `<img>` (swap `src` per frame) or `<canvas>`.

### UX States (the core of what you asked for)

```
  ┌─ minimized ──┐    ┌─ PiP (default) ─┐    ┌─ fullscreen ──────┐
  │ 🌐 chip      │ →  │  ┌───────────┐  │ →  │  ┌─────────────┐  │
  │ "browsing…"  │    │  │ live feed │  │    │  │  live feed  │  │
  └──────────────┘    │  └───────────┘  │    │  │   (large)   │  │
       ▲              │  example.com    │    │  └─────────────┘  │
       └──────────────┤  ● clicking…    │    │  URL bar + actions│
         collapse     └─────────────────┘    └───────────────────┘
```

1. **Minimized** — a chip/pill in the chat: `🌐 browsing example.com`. Click to expand.
2. **PiP (default)** — floating card, ~320×200, bottom-right. Draggable. Shows:
   - Live frame feed
   - Current URL (truncated)
   - Current action label with a pulsing dot: `● clicking "Sign in"`, `● typing…`, `● reading page`
   - Header buttons: expand ⤢, minimize ▁
3. **Fullscreen** — modal overlay (reuse existing `dialog.tsx`), large feed + URL bar + action log timeline.

### Animation
- Use existing **`motion`** lib. `layoutId` shared element so the card morphs smoothly between PiP ↔ fullscreen (no jarring jump).
- Action label changes fade/slide in.

### Action highlighting (polish)
- When the agent clicks/types, draw a brief highlight box over the target element's bounding box (CDP gives coords). Makes it legible *what* the agent is doing, not just *that* it's doing something.

**Ship criteria:** during a browse task, user sees a live mini-screen, can pop it to fullscreen and back.

---

## Phase 2 — "Trust + control"

**Goal:** Human can supervise, intervene, and trust the loop.

- **Take control** — pause the agent, let the user click into the live view (forward UI events → CDP). Hand back to agent.
- **Action timeline** — scrollable log: navigate → click → type → extract, each with thumbnail + timestamp.
- **Persistent sessions** — optional saved auth/cookies per site (behind a setting), so the agent can browse logged-in surfaces.
- **Multi-tab** — tab strip in the viewport.
- **Permission gates** — confirm before destructive actions (submit payment, post, delete), reusing `confirm-dialog.tsx`.

---

## Phase 3 — "Smarter" (optional, later)

- **Hybrid vision** — attach a screenshot to the LLM only when the accessibility tree is insufficient (charts, canvas, visual layout tasks). Cost-gated.
- **Autonomous mode** — agent plans multi-step flows without per-step tool calls.
- **Stealth profile** — swap in Camoufox-style engine for sites that block automation (opt-in).

---

## Open Decisions (need your call)

| Decision | Recommended default | Why |
|----------|--------------------|-----|
| Local Chrome vs bundled Chromium | **Bundled** (with agent-browser) | Version stability, no "install Chrome" step |
| Live frames: `<img>` vs `<canvas>` | **`<img>` first** | Simplest; canvas only if we add overlays/zoom |
| Default viewport state | **PiP, auto-show on first browser action** | Matches your "small screen" idea; non-intrusive |
| Persisted auth | **Off by default**, opt-in per site | Security/privacy; avoid surprise credential storage |
| Frame rate / size | **~6 fps, 640px, JPEG q60** | Smooth enough, cheap on CPU/IPC |

---

## Effort Sketch (rough)

- **Phase 0:** sidecar bundle + 6 tools + activity chip → small/medium.
- **Phase 1:** screencast plumbing + PiP component + fullscreen morph → medium (this is the marquee UX).
- **Phase 2:** take-control + timeline + persistence → medium/large.
- **Phase 3:** opt-in, as-needed.

Recommend: **build Phase 0 + Phase 1 together as the first shippable milestone** — headless tools are dull without the little screen, and the little screen is the "wow."

---

## Phase 0 — Implementation Checklist (in progress)

Concrete, file-level tasks grounded in the current repo layout. Branch: `feat/browser-harness` (this worktree).

> **Integration model corrected during implementation.** The research-era plan
> assumed we'd git-vendor a Rust binary and wire a Tauri `externalBin` sidecar.
> That was wrong on two counts:
>
> 1. **`agent-browser` is an npm package** (`vercel-labs/agent-browser`, 36k⭐,
>    Apache-2.0) that installs a native Rust binary across all 5 target
>    platforms (mac arm64/x64, linux arm64/x64, win x64). It's a normal
>    `dependencies` entry in `agent-sidecar/package.json` — **not** the git-clone
>    `fetch-vendor.mjs` path (that's for TS/JS pi extensions).
> 2. **The tools run inside the Node sidecar**, which can `child_process.spawn()`
>    freely. The Tauri `shell:allow-execute` capability governs the *webview*,
>    not the sidecar — so **no capability change is needed**.
>
> Other facts that shaped the build:
> - **Client-daemon architecture**: the first CLI command auto-starts a Rust
>   daemon that holds the live browser; later invocations attach to it. So each
>   tool = one stateless `execFileSync` spawn, yet `open`→`snapshot`→`click`
>   share one browser. `AGENT_BROWSER_IDLE_TIMEOUT_MS` auto-tears-down the
>   daemon (orphan-process safety net).
> - **Chrome auto-detected**: existing Chrome/Brave/Chromium/Playwright installs
>   are reused, so the ~150MB `agent-browser install` download is usually skipped.
> - **Guardrails are built in**: `--allowed-domains`, `--action-policy`,
>   `--confirm-actions`, `--max-output`.
> - **`--json`** returns `{success, data:{snapshot, refs:{e1:{role,name}}}}`.
> - **`--cdp <port|url>`** is the Phase 1 screencast hook.

### 0.1 — Add `agent-browser` as a sidecar dependency ✅
- [x] `npm install agent-browser` in `agent-sidecar/` (pinned `^0.27.3`). Native
      binary resolves at `node_modules/.bin/agent-browser`.
- [x] Verified it auto-detects local Chromium/Brave (no Chrome download needed).
- [x] Smoke test passes: navigate → snapshot → extract → close against example.com
      (`agent-sidecar/src/browser/smoke.ts`, run via `npx tsx`).
- [ ] **PRODUCTION BUNDLING (follow-up, not Phase 0-blocking).** The Tauri bundle
      ships only `index.cjs` + node binaries as `resources` — **not** node_modules.
      The `agent-browser` native binary must be added to the Tauri `resources`/
      `externalBin` set (per-platform) for packaged builds. Until then the
      executor falls back to a PATH / global `agent-browser` for dev + global
      users. See `agent-browser-executor.ts` header.

### 0.2 — Register the browser tool set as a pi extension ✅
- [x] `agent-sidecar/src/browser/` module: `extension.ts` registers 6 tools via
      `pi.registerTool(...)` (mirrors `office-docs/extension.ts`); wired into the
      `extensionFactories` array in `index.ts` as `zosmaBrowser`.
- [x] `agent-browser-executor.ts` — typed CLI wrapper (binary resolution, `--json`
      parsing, 30s per-call timeout, structured errors).
- [x] Tools (thin wrappers over the CLI):
  - [x] `browser_navigate(url)` → loads page, returns title + URL
  - [x] `browser_snapshot({interactive,urls})` → ref-annotated a11y tree
  - [x] `browser_click(ref)` → click by snapshot ref (or selector)
  - [x] `browser_type(ref, text)` → fill a field
  - [x] `browser_extract({ref?})` → element text, or full-page readable text
  - [x] `browser_close()` → tear down the session
- [x] Unit tests: `tools.test.ts` (6 passing — tool shape + `withScheme`/`normalizeRef`).
- [ ] Session lifecycle: idle-timeout teardown is in place; explicit per-Cowork-
      session isolation (profile/`--session-name`) is a Phase 2 concern.

### 0.3 — Minimal UX: activity chip (next)
- [ ] Emit a `browser:activity` event from the sidecar on each tool call (`{ url, action }`).
- [ ] Render an inline chip in the chat stream (reuse `StatusLine.tsx` styling): `🌐 browsing example.com → reading…`.
- [ ] No screencast yet — text status only (that's Phase 1).

### 0.4 — Guardrails
- [x] Per-call hard timeout (30s) + daemon idle-timeout (60s) so the loop never hangs.
- [x] `--allowed-domains` plumbed through the executor (`ExecutorOptions.allowedDomains`).
- [ ] Surface an allowlist config setting in the UI (default allow-all, confirm on
      first external nav — TBD). agent-browser's `--confirm-actions` /
      `--action-policy` can back the destructive-action gates.
- [x] Headless only; no persisted cookies/auth in Phase 0.

### 0.5 — Done criteria
- [x] navigate → snapshot → extract → close proven end-to-end (smoke test).
- [ ] Prompt "research X and summarize" → agent uses the tools live in the app
      (needs the sidecar built + app run — next session).
- [x] Browser session torn down via explicit `browser_close` + idle timeout.
- [ ] Activity chip visible during a run (0.3).
- [ ] PR opened against `main`.
