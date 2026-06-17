# Browser Harness — Implementation Plan

> **Supersedes** `2026-06-16-browser-harness-plan.md`. Updated 2026-06-17 after
> live spike: agent-browser proven to connect to real Brave, read authenticated
> LinkedIn, post comments, and add reactions — all via CDP WebSocket, zero Python.

## The Vision — Two Modes, One Interface

Zosma Cowork ships **two browser modes** that share the same tool set, so the agent
picks the right tool for the job. The user never has to think about which mode is
active — the viewport appears automatically when the persistent browser is running.

### Mode A: "Quick Browse" (headless, ephemeral, fast)

**What we already have.** The agent uses `agent-browser` headless — launches an
ephemeral Chromium session, navigates, reads the accessibility tree, clicks, types,
and returns results. No live viewport, no persistent cookies. The user sees only
an activity chip: `🌐 Browsing example.com`.

- ✅ Already shipped in Phase 0/0.3 (6 tools + activity chip)
- ✅ Token-efficient: LLM only gets text accessibility tree, never screenshots
- ✅ Fast: ~2s per action, no UI rendering overhead
- ✅ Good for: research, read-and-summarize, data extraction, simple navigation
- ❌ Can't handle: login walls, CAPTCHAs, complex multi-step flows, visual tasks

```
User: "Research the top 5 AI startups from this article"
  → agent calls browser_navigate → browser_snapshot → browser_extract → answers
  → user sees: "🌐 Browsing techcrunch.com" chip in status line
```

### Mode B: "Browser Session" (persistent, live viewport, interactive)

**The enhanced mode from today's demo.** A dedicated, persistent Chromium instance
managed by Cowork — separate from the user's daily browser. The user logs into
LinkedIn/Facebook/CRM *once* inside the viewport, and sessions persist. The
live viewport (PiP ↔ fullscreen) shows every frame of what the agent is doing.
Users can Take Control for logins/CAPTCHAs/MFA, then hand back.

- 🆕 Persistent profile at `~/.config/zosma/browser/` — cookies survive restarts
- 🆕 Live viewport: WebSocket JPEG frame stream → `<img>` in React
- 🆕 Human takeover: click "Take control" → forward mouse/keyboard to CDP
- 🆕 Per-site consent + confirm gates for write actions
- 🆕 Agent can optionally request a screenshot when text alone isn't enough
- 🆕 Optional: "Connect my browser" toggle (attach to user's real Chrome/Brave)

```
User: "Log into my LinkedIn and post this update"
  → viewport appears, browser connects
  → user: logs into LinkedIn once (persisted)
  → agent: opens LinkedIn → composes post → shows preview → user confirms → posted
  → user sees: every frame in the viewport
```

### How they work together

The **same tool interface** powers both modes. The difference is the target:

| | Mode A (Quick Browse) | Mode B (Browser Session) |
|--|----------------------|------------------------|
| Browser instance | Ephemeral, thrown away | Persistent, managed |
| Profile | Fresh each time | `~/.config/zosma/browser/` |
| Viewport | None (activity chip only) | Live PiP ↔ fullscreen |
| Human takeover | No | Yes (Take Control button) |
| Session persistence | No | Yes (cookies survive) |
| Good for | Research, data extraction | Logged-in tasks, workflows |

**The agent decides which to use** based on the task. Quick lookups use Mode A
(fast, cheap). Anything involving auth, posting, or complex orchestration
automatically escalates to Mode B. The user can also explicitly say "open the
browser" to force Mode B.

---

### Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Zosma Cowork App (Tauri + React)                            │
│  ┌─────────────────────┐   ┌─────────────────────────────┐  │
│  │ Chat / Agent        │   │ Browser Viewport (Mode B)   │  │
│  │ (existing)          │   │ ┌─────────────────────────┐ │  │
│  │                     │   │ │  Live JPEG frames (WS)  │ │  │
│  │  agent asks →       │   │ │  URL bar + status       │ │  │
│  │  navigates →        │   │ │  Take Control button    │ │  │
│  │  extracts →         │   │ │  Action timeline        │ │  │
│  │  answers            │   │ └─────────────────────────┘ │  │
│  └──────────┬──────────┘   └─────────────────────────────┘  │
│             │         session.subscribe (existing channel)   │
└─────────────┼────────────────────────────────────────────────┘
              │
      ┌───────▼──────────────────────────────────────────┐
      │  agent-sidecar (Node, pi-agent)                   │
      │                                                   │
      │  ┌──────────────────────────────────────────────┐ │
      │  │ Browser Manager (NEW — Mode B only)          │ │
      │  │ - Launch Chromium with --remote-debugging    │ │
      │  │ - Manage profile at ~/.config/zosma/browser/ │ │
      │  │ - Port allocation + lifecycle                │ │
      │  └────────────┬─────────────────────────────────┘ │
      │               │ CDP: ws://127.0.0.1:<port>        │
      │  ┌────────────▼─────────────────────────────────┐ │
      │  │ agent-browser (Rust binary)                  │ │
      │  │ - navigate / click / type / snapshot / eval  │ │
      │  │ - connect <port> (Mode B)                    │ │
      │  │ - stream enable (Mode B, live frames)        │ │
      │  └────────────┬─────────────────────────────────┘ │
      └───────────────┼───────────────────────────────────┘
                      │
          ┌───────────┴───────────┐
          │ Managed Chromium      │
          │ (Mode B only)         │
          │ ~/.config/zosma/      │
          │   browser/profile/    │
          └───────────────────────┘
```

```
┌──────────────────────────────────────────────────────────────┐
│  Zosma Cowork App (Tauri + React)                            │
│  ┌─────────────────────┐   ┌─────────────────────────────┐  │
│  │ Chat / Agent        │   │ Browser Viewport (resizable) │  │
│  │ (existing)          │   │ ┌─────────────────────────┐ │  │
│  │                     │   │ │  Live JPEG frames (WS)  │ │  │
│  │  agent asks →       │   │ │  URL bar + status       │ │  │
│  │  navigates →        │   │ │  Tab strip (Phase 2)    │ │  │
│  │  extracts →         │   │ │  Take control button    │ │  │
│  │  answers            │   │ └─────────────────────────┘ │  │
│  └──────────┬──────────┘   └─────────────────────────────┘  │
│             │         session.subscribe (existing channel)   │
└─────────────┼────────────────────────────────────────────────┘
              │
      ┌───────▼──────────────────────────────────────────┐
      │  agent-sidecar (Node, pi-agent)                   │
      │                                                   │
      │  ┌──────────────────────────────────────────────┐ │
      │  │ Browser Manager (NEW)                        │ │
      │  │ - Launch Chromium with --remote-debugging    │ │
      │  │ - Manage profile at ~/.config/zosma/browser/ │ │
      │  │ - Port allocation + lifecycle                │ │
      │  └────────────┬─────────────────────────────────┘ │
      │               │ CDP: ws://127.0.0.1:9222          │
      │  ┌────────────▼─────────────────────────────────┐ │
      │  │ agent-browser (Rust binary)                  │ │
      │  │ - navigate / click / type / snapshot / eval  │ │
      │  │ - connect <port> / stream enable             │ │
      │  └────────────┬─────────────────────────────────┘ │
      └───────────────┼───────────────────────────────────┘
                      │ CDP
         ┌────────────▼────────────┐
         │ Chromium (managed)      │
         │ ~/.config/zosma/browser/│
         │ persistent profile      │
         └─────────────────────────┘
```

## What We Know Works (verified in today's spike)

| Capability | Verified | Notes |
|-----------|----------|-------|
| `agent-browser connect 9222` | ✅ | Attaches to any CDP-available browser |
| `agent-browser open` | ✅ | Navigate + wait for load |
| `agent-browser snapshot` | ✅ | Accessibility tree with `[ref=]` handles |
| `agent-browser eval` | ✅ | Arbitrary JS execution in page context |
| `agent-browser click` | ✅ | CSS selector clicks; CDP coordinate clicks |
| `agent-browser screenshot` | ✅ | Full-page screenshot saved to disk |
| `agent-browser type` | ⚠️ | Works on `<input>`/`<textarea>`; **fails on** contenteditable (LinkedIn Quill) — use `eval` as fallback |
| `agent-browser stream enable` | ✅ | WebSocket JPEG stream server on OS-assigned port |
| Real-browser attach via debug port | ✅ | Brave relaunch with `--remote-debugging-port` |
| Authenticated session inheritance | ✅ | Attached to real Brave → all LinkedIn logins available |
| Comment posting (LinkedIn) | ✅ | Via `eval` → insertText + click submit |
| Reaction adding (LinkedIn) | ✅ | Via hover → click Love from reaction flyout |
| Browser relaunch (SIGTERM + new) | ✅ | Clean exit, session restore on relaunch |

## Architecture Decisions

### Decision 1: Managed Chromium (default) + "Connect my browser" (optional)

**Default:** Cowork launches its own headless Chromium on startup with
`--remote-debugging-port=N`. A dedicated profile at `~/.config/zosma/browser/`
persists cookies, extensions, and site data — user logs into LinkedIn/Facebook/CRM
once inside the viewport and it sticks.

**Optional:** an advanced toggle "Connect my browser" that relaunches the user's
real Brave/Chrome with the debug port, exactly as we did in the spike. This gives
immediate access to *all* existing logins without re-entering credentials, but is
more disruptive (process must restart).

Both modes share the same viewport, same tools, same agent loop — only the CDP
target changes.

### Decision 2: Stream via WebSocket, not CDP screencast

`agent-browser stream enable` opens a WebSocket server that sends base64 JPEG
frames only when a WS client is connected. Zero overhead when the PiP is closed.
The React viewport connects to `ws://127.0.0.1:<port>` and feeds frames into an
`<img>` element at ~4-6 fps.

This is already built into agent-browser — we don't need to hand-roll CDP's
`Page.startScreencast`.

### Decision 3: Per-site consent + confirm gates

Every write action (post, comment, DM, reaction, submit) gets a confirmation dialog
in the viewport header area. Per-site permissions stored in
`~/.config/zosma/browser/consent.json`.

---

## Phase 1 — "Browser Session" (Mode B: managed browser + live viewport)

### 1.1 Browser Manager (sidecar — Mode B only)

A new module in `agent-sidecar/src/browser/browser-manager.ts`:

```typescript
class BrowserManager {
  // Launch (or ensure) a managed Chromium with debug port
  async ensureBrowser(): Promise<{ cdpPort: number; profileDir: string }>

  // Connect agent-browser to the managed Chromium
  async connectAgent(): Promise<void>

  // Enable the frame stream WS, report port back to UI
  async enableStream(): Promise<{ wsPort: number }>

  // Get current stream status
  async streamStatus(): Promise<StreamStatus>

  // Shut down Chromium cleanly
  async shutdown(): Promise<void>
}
```

**Responsibilities:**
- Launch Chromium with `--remote-debugging-port=0` (OS-assigned, avoids port conflicts)
- Use dedicated profile dir: `~/.config/zosma/browser/`
- Track PID so we can SIGTERM on app exit
- Expose CDP port + stream WS port via the existing `session.subscribe` event channel
- Idle timeout: close browser after N minutes of no tool activity

### 1.2 New tool: `browser_session` (enter Mode B)

Adds a tool that the agent calls when it determines the task needs the full
browser session (Mode B) — persistent auth, live viewport, human takeover.

```typescript
browser_session({action: "start" | "stop" | "status"})
  → status: "starting" | "connected" | "stopped"
  → info: { cdpPort: number, profileDir: string, streamWsUrl?: string }
```

The agent is prompted to use `browser_session` when:
- The task requires logging into a site
- The task involves posting/commenting/sending (write actions)
- The task needs human oversight
- The accessibility tree alone is insufficient (charts, canvas, visual layout)

For quick research tasks, the agent uses the existing headless tools
(`browser_navigate` etc.) directly — Mode A, no viewport, no overhead.

Adds a new tool that the LLM calls to **ensure the browser is running** before any
navigate/click/type commands. Idempotent (calls `ensureBrowser` + `connectAgent`,
no-op if already connected).

```typescript
browser_connect()
  → status: "connected" | "launching" | "error"
  → info: { cdpPort: number, profileDir: string }
```

This replaces the implicit "first command starts the daemon" — the LLM is
prompted to call `browser_connect` first, then navigate/click/snapshot.

### 1.3 Stream event channel (sidecar → UI)

Extend the existing `session.subscribe` event types with a new event:

```typescript
interface BrowserStreamEvent {
  type: "browser:stream";
  data: {
    wsUrl: string;  // ws://127.0.0.1:<port>
    status: "enabled" | "disabled";
  };
}
```

Sent once when the stream is enabled (after `browser_connect`).

### 1.4 Browser Viewport Component (React)

A new component `BrowserViewport.tsx`:

```tsx
interface BrowserViewportProps {
  /** WebSocket URL from the sidecar stream event */
  streamWsUrl?: string;
  /** Connected state */
  isConnected: boolean;
  /** Current action label (from tool call) */
  currentAction?: string;
  /** Current URL */
  currentUrl?: string;
}
```

**States:**
1. **Disconnected**: "Browser not connected. Click to start." → triggers
   `browser_connect` behind the scenes.
2. **Connected / idle**: Live frame feed, URL bar, status line.
3. **Agent active**: Live feed + pulsing action indicator + click highlight overlay.
4. **Expanded (fullscreen)**: Large viewport via `<Dialog>` with `motion layoutId`.

**Technical details:**
- WebSocket client with auto-reconnect (keepalive every 30s)
- Binary JPEG frames rendered into `<img>` with `requestAnimationFrame` swap (prevents frame stacking)
- URL bar shows current host/page title (from periodic `eval` `document.title` calls)
- Action highlight overlay: when tool is `browser_click`, draw a brief box using bounding box data from CDP
- Performance: frames only flow when WS is connected, which happens only when viewport is visible

### 1.5 Animated states (chip → PiP → fullscreen)

Using the existing `motion` library:

| State | Trigger | Animation |
|-------|---------|-----------|
| **Disconnected** | App start, no browser running | Static text: "🌐 Browser ready" |
| **Agent active** | Agent calls `browser_connect` + tools | Pulsing dot + action label | 
| **PiP** | Default, or collapse from fullscreen | Small floating card, ~360×220, bottom-right-ish area |
| **Fullscreen** | Click ⤢ or "Expand" button | `motion.div` with shared `layoutId` morphs PiP → fullscreen dialog |

The chip/status line already shows `Browsing <domain>` etc. (Phase 0.3), which
acts as the minimized state.

### 1.6 Managed browser lifecycle

```
┌───────────────────────────────────────────────────┐
│ App Start                                          │
│   │                                                │
│   ▼                                                │
│ Browser Manager.ensureBrowser()                    │
│   │— Launch Chromium (headed? headless?)           │
│   │   Default: headless with --window-size for     │
│   │   screenshots. User can toggle "Show window"   │
│   │   to make it visible (for debugging).          │
│   │                                                │
│   ▼                                                │
│ agent-browser connect <port>                        │
│   │                                                │
│   ▼                                                │
│ agent-browser stream enable                         │
│   │— WS server on port N                           │
│   │— Send wsUrl to UI via session.subscribe         │
│   │                                                │
│   ▼                                                │
│ UI connects to WS, renders frames                   │
│                                                    │
│ Agent loop: navigate → ... tools ... → answer       │
│                                                    │
│   ▼ (on idle timeout or app close)                 │
│ agent-browser close → SIGTERM Chromium              │
└───────────────────────────────────────────────────┘
```

### 1.7 Integration points

| File | Change |
|------|--------|
| `agent-sidecar/src/browser/browser-manager.ts` | **NEW** — Chromium lifecycle, stream management |
| `agent-sidecar/src/browser/tools.ts` | Add `browser_connect` tool + fallback `eval`-based type for rich editors |
| `agent-sidecar/src/browser/agent-browser-executor.ts` | Add `connectAgent`, `streamEnable`, `streamStatus` methods |
| `agent-sidecar/src/browser/extension.ts` | Register `browser_connect` tool |
| `src/components/BrowserViewport.tsx` | **NEW** — the live viewport component |
| `src/components/BrowserViewport.test.tsx` | Unit tests for states |
| `src/App.tsx` | Mount `BrowserViewport` next to chat or in the layout |
| `src/hooks/useBrowserViewport.ts` | **NEW** — WS client + frame consumer + state machine |
| `src/lib/statusLabels.ts` | Add `browser_connect` → "Connecting browser…" phrase |
| `src/styles/` | Viewport styles |

### 1.8 Phase 1 ship criteria

- [ ] User opens Cowork → browser starts automatically
- [ ] "🌐 Browser connected" shown in status area
- [ ] User asks agent to "go to linkedin.com" → viewport shows LinkedIn loading live
- [ ] Agent reads page → extracts text → returns answer
- [ ] User can click "Expand" → viewport goes fullscreen, morphs smoothly
- [ ] User can collapse back to PiP
- [ ] User can log into LinkedIn within the viewport (type their email/password)
- [ ] Next session, login persists (profile saved)

---

## Phase 2 — "User Takes Control"

### 2.1 Interactive viewport (mouse/keyboard forward)

When the user clicks the "Take control" button:
1. Agent pauses (tool loop suspended)
2. Mouse clicks on the viewport are forwarded to CDP `Input.dispatchMouseEvent`
3. Keyboard input is forwarded to CDP `Input.dispatchKeyEvent`
4. User can interact with the page directly (log in, fill CAPTCHA, navigate)
5. "Hand back" button resumes the agent

This requires a WebSocket or IPC channel from the webview to the sidecar for
input events. Since the sidecar already speaks HTTP/WS, we can:
- Add a small HTTP endpoint on the sidecar: `POST /browser/click {x,y}` etc.
- Or reuse the WS channel that already carries frames (bidirectional)

### 2.2 Confirm gates for writes

When the agent attempts a destructive action (submit, post, delete, send):
1. Sidecar detects `browser_click` on a submit-like element (heuristic or via prompt)
2. UI shows a confirmation dialog: "Allow posting this comment?"
   - Shows the text the agent typed (from `browser_type` args)
   - Shows the target site (linkedin.com)
   - Buttons: **Allow** · **Edit** · **Deny**
3. Agent waits for response; Deny cancels the tool call

### 2.3 Action timeline

A scrollable log next to or below the viewport:

```
▶ Navigated to linkedin.com                12:34:01
⏳ Reading the page…                       12:34:04
✏️ Typed in comment box                    12:34:10
👆 Clicked "Post"                           12:34:12
✅ Comment posted                           12:34:14
```

Each entry has a small thumbnail of that moment (from the frame stream history).

### 2.4 Tab strip

Show open tabs (from CDP `Target.getTargets`), allow switching, closing, creating new.

---

## Phase 3 — "Domain Skills + Workflows"

### 3.1 Pre-seeded domain skills

Ship a curated set of agent-browser skill files for high-value sites:
- **linkedin/** — profile research, post/comment patterns, connection request flow
- **facebook/** — page feed reading, group posts
- **salesforce/** — record viewing, report extraction
- **hubspot/** — contact search, pipeline view
- **gmail/** — email reading, sending (already partially covered by Gmail API tool)

These live in `agent-sidecar/src/browser/skills/` and are loaded as part of the
agent's system prompt (context window permitting) or on-demand via domain detection.

### 3.2 "Connect my browser" — attach Mode B to user's real browser

A toggle in settings that, instead of the managed Chromium, attaches Mode B to
the user's real Chrome/Brave:

A toggle that, instead of the managed Chromium, attaches to the user's real
Chrome/Brave:
1. Detect running Chrome/Brave via `pgrep` / `tasklist`
2. If running with debug port → connect directly
3. If running without → prompt user: "Cowork needs to restart your browser to
   attach. Your tabs will be restored." → SIGTERM → relaunch with `--remote-debugging-port`
4. If not running → launch with debug port on their default profile

This gives the agent access to ALL the user's existing logins, extensions, and
cookies with zero re-authentication. As we proved in the spike: one command,
instant LinkedIn session access.

### 3.3 Workflow library (AI-generated playbooks)

When the agent figures out a reliable flow for a site (selectors, clicks, gotchas),
it saves it as a skill file — just like browser-harness's self-improving model.
Over time, Cowork's browser gets smarter about every site it visits.

---

## Open Questions (need your call)

| Question | Options | Recommendation |
|----------|---------|---------------|
| **Chromium: headless vs headed?** | Headless (no visible window) vs headed (user can see the managed browser window) | **Headless** — the viewport *is* the window. User never needs a separate Chrome window. Exception: headed mode as debug toggle. |
| **Profile persistence: opt-in or default?** | Save/restore cookies by default, or ask on first form fill | **Default on** — persistent profile with a "Clear browser data" button. The whole point is "log in once." |
| **Viewport placement** | Right panel (replacing/existing sidebar) vs bottom panel (above composer) vs floating overlay | **Right side, collapsible** — replaces the existing "Context" panel when browsing. PiP mode floats over the chat. |
| **`browser_connect` implicit vs explicit?** | Agent auto-calls browser_connect on first browse, vs user clicks a "Start browser" button | **Implicit + idle** — first browse tool auto-starts. Dedicated "Stop browser" to free memory. |
| **Stream quality** | 640px vs 960px, JPEG q60 vs q80, 4fps vs 8fps | **640px, q60, 6fps** — smooth enough, cheap; bump in settings later |

---

## Effort Estimate

| Phase | Files changed | Rough effort |
|-------|--------------|-------------|
| **1.1 Browser Manager** | 3-4 files (sidecar) | Small (~1 session) |
| **1.2 browser_connect tool** | 2 files (sidecar) | Small (~1hr) |
| **1.3 Stream event channel** | 2 files (sidecar + types) | Small |
| **1.4 Browser Viewport** | ~4 files (React + hook + styles) | Medium (~1 session) |
| **1.5 Animated states** | 1-2 files (within Viewport) | Small (motion is already there) |
| **Phase 1 total** | ~12 files | **2-3 focused sessions** |
| **Phase 2** | ~8 files | Medium (bi-di input forwarding is the hard part) |
| **Phase 3** | ~10 files | Medium (domain skills + connect-my-browser) |

---

## Gotchas We Learned Today

1. **`agent-browser type` doesn't work with contenteditable editors** (LinkedIn's
   Quill). Use `eval` with `execCommand('insertText')` as fallback for rich text
   inputs. Consider enhancing `browser_type` to detect contenteditable → use `eval`.

2. **Chromium ProcessSingleton locks profile to one process.** For the managed
   browser this is a non-issue (it's our profile). For "Connect my browser" the
   user's real browser must be closed first.

3. **LinkedIn reaction flyout requires `pointerover` + `mouseover` events** to
   render. Just dispatching `click` on the Like button gives a thumbs-up; you
   must hover first to get the Love/Celebrate/etc. picker.

4. **`agent-browser find role link first click` syntax doesn't work.** Use
   CSS selectors with `click` or `eval` + `document.querySelector().click()`.

5. **Brave version 148+ supports `chrome://inspect` remote-debugging checkbox**
   as an alternative to `--remote-debugging-port` — but we haven't tested
   whether agent-browser can discover that without the explicit port.

6. **Wayland requires `--ozone-platform=wayland`** for headed mode — without it,
   the Chromium window doesn't appear on Wayland compositors.
