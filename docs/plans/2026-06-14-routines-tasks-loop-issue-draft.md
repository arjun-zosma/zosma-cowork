# Epic draft: Tasks tab — scheduling via pi-routines

> Paste into `gh issue create`. Suggested labels: `enhancement`, `epic`.
> Title: **Epic: Tasks tab — scheduled agent tasks via pi-routines**

---

## Summary

Add a **Tasks** experience to Zosma Cowork backed by the
[`pi-routines`](https://www.npmjs.com/package/pi-routines) extension (a faithful
port of Claude Code's cron scheduler). Tasks are scheduled prompts that fire as
user messages — recurring routines or one-shots. Full spec:
[`docs/plans/2026-06-14-routines-tasks-loop.md`](../blob/main/docs/plans/2026-06-14-routines-tasks-loop.md).

`pi-loop` (autonomous build) is **out of scope** for this epic and deferred.

## IA changes

- Rename the **Chats** tab → **Cowork** (the conversational surface).
- **Remove** the **Templates** tab (delete `PromptTemplates` + `data/templates.ts`)
  and **replace** it with a **Tasks** tab.
- Tasks tab lists scheduled tasks; selecting one opens a **Task Detail** page in
  the main/right area (name, prompt, schedule, next/last run, status, run-now /
  pause / delete). A "Workflow" view is a later iteration.
- **Tasks are created from chat** in the Cowork tab — the user asks in natural
  language and the agent calls `cron_create`. No create-form for MVP.

## Why

Claude Cowork ships Routines/Tasks; Cowork has none. `pi-routines` already
provides the scheduler (tools `cron_create` / `cron_delete` / `cron_list`,
durable `.pi/scheduled_tasks.json` persistence, PID lock, chokidar hot-reload,
missed-task recovery, jitter). The sidecar already loads pi extensions
(`disk-extension-loader.ts`) and the bundled pi (0.74.2) already exposes
`sendUserMessage` / `registerTool` / lifecycle events (verified). So this is
**integration + UI**, not a scheduler build.

## Technical notes (verified)

- **Loading:** install pi-routines via the existing extension path
  (`~/.pi/agent/settings.json` `packages` / `extension-manager.ts`).
- **Firing:** pi-routines calls `pi.sendUserMessage()`; the API exists in the
  bundled pi 0.74.2 (`ExtensionAPI.sendUserMessage`, bound in runner `bindCore`).
- **UI bridge (no LLM):** add sidecar commands `tasks_list` / `tasks_delete` /
  `tasks_set_enabled` / `tasks_run_now` (cf. `command-queue.ts`,
  `list_extensions`) reading the per-cwd `.pi/scheduled_tasks.json`, plus a
  change push event over the event-bus for live updates.
- **Components touched:** `Sidebar.tsx` (TABS), `MobileBottomNav.tsx`, `App.tsx`
  (`sidebarView` widen to `chats | tasks | settings`), new `TasksList` +
  `TaskDetail`, delete `PromptTemplates*` + `data/templates.ts`.

## Decisions to resolve

- [ ] **Always-on?** pi-routines fires only while a session is live; Cowork is a
      desktop app. MVP = fire while open; full = headless sidecar daemon +
      autostart + native notifications.
- [ ] **Version skew** — pi-routines peer `>=0.78.0`; sidecar bundles `0.74.2`.
      Validate in the spike or bump pi.
- [ ] **Session/project binding** — `.pi/scheduled_tasks.json` is per-cwd; decide
      per-project vs global tasks for multi-window Cowork.
- [ ] **Vendor-fork vs npm dep** — fork (like office-docs/google) for UI hooks &
      notifications, or depend on third-party npm (`offbynan/pi-routines`).
- [ ] **Bridge source of truth** — read JSON file vs call extension tools.

## Phasing (sub-issues to file)

- [ ] **P0 — Spike (S):** install pi-routines in sidecar; `* * * * *` durable task
      fires `sendUserMessage` into a live Cowork chat. Resolves version-skew +
      UI-surfacing risks.
- [ ] **P1 — IA rename (S):** Chats→Cowork, remove Templates tab + components,
      add empty Tasks tab scaffold. Update Sidebar, MobileBottomNav, App view
      state + tests.
- [ ] **P2 — Tasks bridge (M):** sidecar `tasks_list/delete/set_enabled/run_now`
      + change push event.
- [ ] **P3 — Tasks UI (M):** `TasksList` (left) + Task Detail page (right);
      create-from-chat confirmation chip; fires while Cowork is open.
- [ ] **P4 — Always-on daemon (L):** headless sidecar + autostart + native
      notifications.
- [ ] **Later — `/loop` command (S):** surface in composer (depends on #179 / #183).
- [ ] **Later — pi-loop autonomous mode (L):** bundle + spawn pi-loop CLI; possible
      "Workflow" view on task detail.

## References

- Spec: `docs/plans/2026-06-14-routines-tasks-loop.md`
- pi-routines: https://github.com/offbynan/pi-routines
- Related: #179, #183 (slash commands), #201 (steering), #128 (sidecar bundling)
