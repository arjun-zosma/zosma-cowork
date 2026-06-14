# Tasks (pi-routines) — scheduling in Zosma Cowork

_Status: spec / draft — 2026-06-14 — tracking issue: [#285](https://github.com/zosmaai/zosma-cowork/issues/285)_

## Decision (locked)

- **Ship `pi-routines` first.** It backs the new **Tasks** tab. `pi-loop`
  (autonomous build) is deferred to a later, separate effort.
- **Information architecture changes:**
  - Rename the **Chats** tab → **Cowork** (the conversational surface).
  - **Replace** the **Templates** tab with a **Tasks** tab (Templates removed).
  - Tasks tab lists scheduled tasks/routines; selecting one opens a **task
    detail page** in the main (right) area. "Workflow" view is a later add —
    for the MVP the detail page just shows task detail.
  - **Tasks are created from chat** in the Cowork tab: the user asks in natural
    language and the agent calls `cron_create` (pi-routines). No separate
    create-form is required for the MVP (a manual "New task" form is a P1+ nicety).

## Summary

Bring Claude Cowork's **Routines**, **Tasks**, and **Loop** to Zosma Cowork by
adopting two existing pi extensions instead of building a scheduler from scratch:

- **[`pi-routines`](https://www.npmjs.com/package/pi-routines)** — a faithful
  port of Claude Code's internal cron scheduler, packaged as a pi extension.
  Provides recurring/one-shot scheduled prompts. Covers **Routines**, **Tasks**,
  and the session **`/loop`** command.
- **[`pi-loop`](https://www.npmjs.com/package/pi-loop)** — a standalone
  planner-worker-judge autonomous coding CLI. Covers the **Loop** (autonomous
  build) experience. Different integration shape (subprocess, not extension).

This is the inverse of how Claude Cowork shipped them as three separate
surfaces; in pi the first three collapse onto one extension.

## Why

Claude Cowork now ships Routines (recurring agent jobs), Tasks (scheduled
one-shots), and Loop (autonomous multi-step build). Cowork has none of these.
The pi ecosystem already has battle-tested equivalents, so the work is
**integration + UI**, not a scheduler from scratch.

## Mapping

| Claude Cowork | pi primitive | Source |
|---|---|---|
| Routine (recurring) | `cron_create` durable, `recurring: true` | pi-routines |
| Task (one-shot scheduled) | `cron_create` durable, `recurring: false` | pi-routines |
| `/loop` (session repeat) | `/loop <interval> <prompt>` command | pi-routines |
| Loop (autonomous build) | planner-worker-judge CLI | pi-loop |

## What `pi-routines` gives us (v0.1.0)

- Tools surfaced to the agent: `cron_create`, `cron_delete`, `cron_list`.
- Command: `/loop <interval> <prompt>` — schedules a recurring **session** task
  and runs it immediately.
- Background scheduler: 1s poll, fires by calling `pi.sendUserMessage(prompt)`.
- Durable tasks persisted to `.pi/scheduled_tasks.json` (survive restart);
  session tasks in-memory.
- Cross-process PID lock (`.pi/scheduled_tasks.lock`) prevents double-fire
  across multiple pi instances.
- chokidar hot-reload of the task file; missed one-shot recovery on startup;
  7-day auto-expiry (configurable); jitter to avoid thundering herd.
- Peer dep declared `@earendil-works/pi-coding-agent >=0.78.0`.

## What `pi-loop` gives us (v0.1.5)

- A CLI (`bin: pi-loop`) — **not** a pi extension (`pi: null` in its
  package.json). Bundles agent prompts (decomposer, coder, judge,
  code-reviewer, review-optimizer).
- Autonomous planner → worker → judge loop for AI-driven development.
- Integration shape: spawn as a subprocess and stream output, similar to how
  the sidecar already drives sessions — **not** loaded via the extension loader.

## UX / IA — the Tasks tab

Current shell (verified):
- `src/components/Sidebar.tsx` — left glass panel with a 2-tab pill switcher
  `TABS = [chats, templates]` + a Settings footer. `activeTab` derives from the
  `view` string.
- `src/components/MobileBottomNav.tsx` — mirrors the same tabs (Chats /
  Templates / Settings) for mobile.
- `src/App.tsx` — `sidebarView` state (`"chats" | "templates" | "settings"`),
  `onChangeView` switches it; the main content area renders the chat thread.
- `src/components/PromptTemplates.tsx` + `src/data/templates.ts` — the
  Templates panel being removed.

Target shell:
- **Tab labels:** `chats` tab relabel **"Chats" → "Cowork"** (icon
  `MessageSquare`); replace `templates` tab with **"Tasks"** (id `tasks`, icon
  e.g. `ListChecks`/`CalendarClock`). Update both `Sidebar.tsx` `TABS` and
  `MobileBottomNav.tsx`.
- **View state:** widen `sidebarView` to `"chats" | "tasks" | "settings"`;
  remove the `templates` branch and `onUseTemplate` plumbing. Delete
  `PromptTemplates*` and `data/templates.ts` (and their tests).
- **Tasks panel (left):** new `TasksList` component in the sidebar content area
  (replacing the `PromptTemplates` slot) — lists tasks from
  `cron_list` / the sidecar bridge with name, schedule (human-readable), next
  run, and recurring/one-shot + enabled state. Click selects a task.
- **Task detail (right / main):** selecting a task swaps the main content area
  from the chat thread to a **Task Detail** page showing: name, prompt,
  cron expression + human-readable schedule, type (durable/session),
  recurring, next run, last run, status, and actions (run-now, pause/enable,
  delete). "Workflow" visualization is a later iteration — MVP = detail only.
- **Create from chat:** no dedicated form for MVP. In the Cowork tab the user
  says e.g. “every weekday at 9am summarize my unread email”; the agent calls
  `cron_create`. After creation, surface a confirmation chip and the new task
  appears in the Tasks tab.

### Sidecar bridge for the UI

The Tasks UI must read/write tasks without going through the LLM. Add sidecar
commands (cf. `command-queue.ts` / `remote-server.ts` patterns, e.g.
`list_extensions`) that proxy pi-routines’ task store:
- `tasks_list` → read `.pi/scheduled_tasks.json` (+ in-memory session tasks).
- `tasks_delete` / `tasks_set_enabled` / `tasks_run_now`.
- A push event when the store changes (pi-routines already watches the file via
  chokidar) so the Tasks list live-updates.
Decide whether these call the extension’s tools directly or read the JSON file
(per-cwd). The file is the simplest source of truth for the list view.

## Integration mechanics (Cowork sidecar)

Verified against the bundled pi in `agent-sidecar`:

1. **Extension loading already exists.** `disk-extension-loader.ts` loads pi's
   disk/npm/git extensions via virtualModules-backed jiti from
   `~/.pi/agent/settings.json` `packages` + `~/.pi/agent/extensions`.
   `extension-manager.ts` can install npm packages from the UI. So
   `pi-routines` can be installed/enabled through the existing path.
2. **The firing API exists.** `pi-routines` fires via
   `pi.sendUserMessage()`. The bundled pi is **0.74.2**; its `ExtensionAPI`
   already exposes `sendUserMessage`, `registerTool`, `registerCommand`, and
   the `session_start`/`session_shutdown` lifecycle events the extension needs
   (`agent-sidecar/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`).
   The runner binds `runtime.sendUserMessage = actions.sendUserMessage` in
   `bindCore`.

## Open questions / risks

1. **Always-on vs desktop lifecycle (the big one).** `pi-routines` only fires
   while a pi session is live. Cowork is a desktop app — close the window and
   routines stop. "Run while I'm away" requires the sidecar to run as a
   **background daemon** independent of any open window. Decide:
   - (a) routines only fire while Cowork is open (MVP, honest), or
   - (b) a headless sidecar daemon + OS autostart + notifications (full).
2. **Version skew.** pi-routines peer `>=0.78.0`; sidecar bundles `0.74.2`. The
   API surface used is present in 0.74.2, but we must run it and confirm no
   newer API is referenced (e.g. task/UI hooks). May force a pi bump.
3. **sendUserMessage → UI surfacing.** The sidecar normally drives prompts via
   `command-queue → activeSession.prompt()`. Confirm an extension-initiated
   `sendUserMessage` (a) reaches the active session and (b) renders in the
   Cowork chat UI via the event-bus, including when no turn is in flight.
4. **Which session?** Routines fire into "the" session. Cowork is multi-session
   / multi-window. Decide whether a routine binds to a specific chat/project
   cwd (the lock + `.pi/scheduled_tasks.json` are per-cwd) or a global one.
5. **UI surface.** None exists. Need a Routines/Tasks manager (Settings tab or
   dedicated view) to create/list/delete/pause — not just agent-driven tools.
6. **Fork our own vs depend on npm.** pi-routines is third-party (`offbynan`).
   Decide vendor-fork (like office-docs/google) vs npm dependency, given we may
   need UI hooks, per-session binding, and notification surfacing it lacks.
7. **pi-loop packaging.** CLI must ship inside the Tauri bundle (node binary /
   sidecar binaries, cf. #128) and be spawned + streamed; design its UI as a
   distinct "Loop / autonomous build" mode, separate from Routines.

## Proposed phasing

- **P0 — Spike (S) — #286:** install pi-routines into the sidecar, create a
  `* * * * *` durable task, confirm it fires `sendUserMessage` into a live
  Cowork chat. Resolves risks #2 and #3. Document outcome.
- **P1 — IA rename (S) — #287:** “Chats” → “Cowork”, remove Templates tab +
  delete `PromptTemplates`/`data/templates.ts`, add empty **Tasks** tab
  scaffold. Update `Sidebar.tsx`, `MobileBottomNav.tsx`, `App.tsx` view state
  + tests.
- **P2 — Tasks bridge (M) — #288:** sidecar
  `tasks_list/delete/set_enabled/run_now` commands + change push event over the
  existing event-bus.
- **P3 — Tasks UI (M) — #289:** `TasksList` (left) + **Task Detail** page
  (right), fires only while Cowork is open. Create-from-chat confirmation chip.
- **P4 — Always-on daemon (L) — #290:** headless sidecar daemon + autostart +
  native notifications so tasks fire while Cowork is closed. Resolves risk #1.
- **Later — `/loop` command (S) — #291:** surface `/loop` in the composer
  (depends on slash-command epic #179/#183).
- **Later — pi-loop autonomous mode (L) — #292:** bundle + spawn pi-loop CLI as
  a distinct autonomous-build mode; possible “Workflow” view on the task detail
  page.

## References

- pi-routines: https://www.npmjs.com/package/pi-routines · https://github.com/offbynan/pi-routines
- pi-loop: https://www.npmjs.com/package/pi-loop
- Related: slash-command epic #179 / #183, steering #201, sidecar bundling #128
