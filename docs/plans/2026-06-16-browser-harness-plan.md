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

## Phase 0 — Implementation Checklist (start here)

Concrete, file-level tasks grounded in the current repo layout. Branch: `feat/browser-harness` (this worktree).

### 0.1 — Vendor the `agent-browser` binary as a sidecar
- [ ] Add `agent-browser` (Rust) build/fetch to the sidecar bundling step (mirror the existing `pi-routines` vendor pattern — see `agent-sidecar/` fetch-vendor scripts).
- [ ] Place the platform binary under the Tauri sidecar path so `externalBin` picks it up (`src-tauri/tauri.conf.json` → `bundle.externalBin`).
- [ ] Add a `shell:allow-execute` allow-entry for the `agent-browser` sidecar in `src-tauri/capabilities/default.json` (today only `sh -c` is allowed).
- [ ] Smoke test: from the sidecar, spawn `agent-browser`, navigate to a URL, get a snapshot back.

### 0.2 — Register the browser tool set as a pi extension
- [ ] New extension module under `agent-sidecar/` exposing `tools: [...]` (follow the `extension-manager.ts` / `disk-extension-loader.ts` `virtualModules` registration pattern).
- [ ] Tools (thin wrappers over `agent-browser` CLI calls):
  - [ ] `browser_navigate(url)` → loads page, returns title + URL
  - [ ] `browser_snapshot()` → accessibility-tree text (token-efficient)
  - [ ] `browser_click(ref)` → click by snapshot ref id
  - [ ] `browser_type(ref, text)` → type into field
  - [ ] `browser_extract(query)` → return relevant text for the query
  - [ ] `browser_close()` → tear down the ephemeral session
- [ ] Session lifecycle: one ephemeral browser per agent run; auto-close on run end.

### 0.3 — Minimal UX: activity chip
- [ ] Emit a `browser:activity` event from the sidecar on each tool call (`{ url, action }`).
- [ ] Render an inline chip in the chat stream (reuse `StatusLine.tsx` styling): `🌐 browsing example.com → reading…`.
- [ ] No screencast yet — text status only (that's Phase 1).

### 0.4 — Guardrails
- [ ] Allowlist/denylist for navigable domains (config setting, default allow-all with a confirm on first external nav — TBD).
- [ ] Hard timeout per tool call (e.g. 30s nav) so the agent loop never hangs.
- [ ] Headless only; no persisted cookies/auth in Phase 0.

### 0.5 — Done criteria
- [ ] Prompt "research X and summarize" → agent navigates, snapshots, extracts, answers — with the activity chip visible during the run.
- [ ] Browser session always torn down (no orphan Chromium processes).
- [ ] Docs updated; PR opened against `main`.
