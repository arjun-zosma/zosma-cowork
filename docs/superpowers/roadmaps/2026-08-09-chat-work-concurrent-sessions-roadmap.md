# Chat, Work, and Concurrent Sessions Roadmap

> **For agentic workers:** Use /skill:writing-plans to create one detailed implementation plan per phase. Start with Phase 1 and proceed sequentially unless the user explicitly changes the order.

**Goal:** Deliver readable Chat and task-oriented Work experiences with true concurrent session execution, instant switching, user-facing outputs/sources, and selected-text actions.

**Design Spec:** [`docs/superpowers/specs/2026-08-09-chat-work-concurrent-sessions-design.md`](../specs/2026-08-09-chat-work-concurrent-sessions-design.md)

**Planning Strategy:** Runtime isolation and session identity come first because every later screen depends on trustworthy per-session state. Each phase leaves the existing product usable and CI-green, while keeping one detailed plan within a manageable context window.

---

## Phase 1: Session Runtime and Identity Foundation

**Outcome:** The sidecar owns session-scoped runtimes keyed by canonical session file, and every session-bound command/result/event carries explicit session identity. Cowork still presents the current single-active-session UX during this migration.

**Why now:** Concurrent UI cannot be correct while the sidecar stores the active session, scheduler, watchdog, queue, model, and workspace in singleton globals. Explicit identity must reach the frontend before background events can be retained safely.

**Scope:**
- Introduce `SessionRuntimeManager` and move session-specific state into `SessionRuntime` objects.
- Canonicalize session paths, make cold loads idempotent, and deduplicate simultaneous loads.
- Make prompt scheduling, abort/watchdog state, model choice, workspace/resource loading, queue operations, and SDK subscriptions runtime-local.
- Implement the approved snapshot, event, result, and structured-error wire contracts.
- Pass `sessionFile` through sidecar commands, Tauri relay commands, and frontend stream operations.
- Keep global auth, model registry, and stable settings shared.
- Preserve current stop-on-switch behavior at the frontend boundary until Phase 2 can retain hidden streams correctly.
- Add regression coverage for two isolated runtimes even though the visible UI remains single-active.

**Out of scope:**
- Running two sessions from the visible UI.
- Cached keyed frontend stream state or sidebar runtime indicators.
- Chat/Work modes and visual redesign.

**Key files/areas likely affected:**
- `agent-sidecar/src/index.ts`, `agent-init.ts`: replace singleton session setup with runtime-manager ownership.
- `agent-sidecar/src/prompt-runner.ts`, `prompt-scheduler.ts`: remove process-global prompt state and make execution runtime-scoped.
- `agent-sidecar/src/commands/types.ts`, `handler-registry.ts`: establish session-bound command contracts.
- `agent-sidecar/src/commands/handlers/core.ts`, `handlers/sessions.ts`: resolve target runtime instead of current session.
- `agent-sidecar/src/protocol.ts`, `event-bus.ts`, `extension-ui-bridge.ts`: attach and preserve session identity.
- `src-tauri/src/lib.rs`: forward tagged commands, results, errors, and events without owning runtime state.
- `src/hooks/usePiStream.ts`, `src/types/pi-events.ts`, `src/App.tsx`: send the active session file and consume tagged envelopes while retaining one visible reducer.

**Dependencies:**
- Approved design spec.
- Existing Pi `SessionManager` persistence and Cowork session-file identity.

**Verification:**
- Sidecar tests demonstrate independent schedulers, queues, models, workspaces, events, and abort behavior for two runtimes.
- Duplicate cold loads resolve to one runtime and return a complete snapshot.
- Commands targeting unknown sessions return `session_not_loaded` rather than falling back to another runtime.
- Existing single-session prompt, steering, follow-up, model selection, load/new-session, and abort flows continue to pass.
- Sidecar tests/build, frontend tests/typecheck, relay tests, lint, and production frontend build remain green.

**Phase boundary health:** The app behaves as it does today from the user's perspective. Internally, identity and isolation are ready for concurrency, but the frontend still stops the active run before switching so no hidden event is lost.

**Risks:**
- Process-global state may remain in prompt watchdogs or extension bindings. The detailed plan must trace every read/write of the current session and active prompt, then prove isolation with two-runtime tests.
- SDK subscriptions may emit after abort or reload. Runtime identity must be captured when subscribing, not inferred from whichever session is active later.
- Protocol migration can break Tauri correlation. Preserve existing command IDs and terminal response behavior while adding session fields.

**Context notes:** This phase is an architectural migration, not a concurrency UI phase. Do not add spinners or claim background execution yet. Prefer one manager and existing SDK primitives over parallel replacement abstractions.

---

## Phase 2: Concurrent Execution, Cached Switching, and Sidebar Status

**Outcome:** Users can start work in several sessions, switch instantly between loaded sessions, and see which sessions are running, idle, or failed. Hidden sessions continue streaming and persisting.

**Why now:** Phase 1 provides trustworthy runtime identity. The frontend can now retain all tagged events instead of resetting one global stream state on every session change.

**Scope:**
- Replace the single visible stream reducer with `Map<SessionFile, StreamState>` while reusing the existing reducer for each map entry.
- Hydrate and cache complete session snapshots; switching changes only the active render key.
- Dispatch every tagged event, optimistic prompt, queue update, abort, error, and completion to its target session.
- Remove stop-on-switch behavior and allow separate runtime schedulers to execute in parallel.
- Show accessible animated running indicators and error indicators in session rows.
- Keep active-row styling independent from runtime status.
- Show a running-count badge when navigation is collapsed.
- Isolate model selection, steering, follow-up, queue clearing, and abort by session.
- Require `Stop and delete` confirmation for running sessions.
- Mark interrupted running sessions after sidecar loss without corrupting persisted history.
- Keep loaded runtimes in memory until deletion or app shutdown; do not add eviction or an arbitrary concurrency cap.

**Out of scope:**
- Chat/Work mode distinction.
- Outputs/Sources rail.
- Selected-text actions.

**Key files/areas likely affected:**
- `src/hooks/usePiStream.ts` and tests: keyed stream controller and event routing.
- `src/App.tsx`: active-session selection, snapshot hydration, and session-scoped command handlers.
- `src/components/Sidebar.tsx`, `ConversationSearch.tsx`: runtime indicators, error state, running deletion flow, and collapsed badge.
- `src/types/index.ts`, `src/types/pi-events.ts`: snapshot and runtime-status types.
- `agent-sidecar/src/SessionRuntimeManager` area and session handlers: concurrent lifecycle, snapshots, shutdown, and deletion coordination.
- `src-tauri/src/lib.rs`: sidecar-loss handling and tagged event forwarding validation.

**Dependencies:**
- Phase 1 session runtime manager and tagged protocol.

**Verification:**
- Two sessions stream simultaneously and update only their own cached state.
- Switching a loaded session renders from cache within `100ms` without a backend load or abort.
- Abort A, model changes in A, and queue operations in A leave B unchanged.
- A hidden session can finish, update its sidebar state, and render its complete result when reopened.
- Rapid clicks on a cold session trigger one load.
- Sidecar restart and running-session deletion follow the approved failure behavior.
- Manual acceptance passes: start Work-like task A, switch to session B, run B, return to A, steer A, and observe B continue unchanged.

**Phase boundary health:** Cowork remains visually the current Chat product, but now has complete multi-session execution and navigation. No later Chat/Work UI is required for this capability to be useful.

**Risks:**
- High-frequency hidden events may cause whole-app rerenders. Keep keyed reducer updates local and select only active/session-row summaries for rendering.
- Session list refreshes could overwrite live cached state with stale disk snapshots. Define live runtime state as authoritative while running and reconcile persistence only after completion.
- Existing App-level effects may assume one session. The detailed plan must inventory effects keyed by `sessionKey`, `thinking`, model, workspace, and completion.

**Context notes:** Preserve the tested `streamReducer`; wrap it instead of duplicating its parsing logic. True concurrency is complete only when the sidebar indicator reflects real sidecar state and switching performs no abort/rebind.

---

## Phase 3: Chat/Work Mode, Empty States, and Readable Typography

**Outcome:** New sessions offer Chat and Work modes before the first prompt, lock the selected mode afterward, and display the approved mode-specific empty states with larger readable defaults.

**Why now:** Concurrent session behavior is stable, so mode can be persisted and rendered per session without coupling layout work to the runtime migration. Active Work's result surface depends on this mode contract.

**Scope:**
- Extend existing `cowork-meta.json` metadata with `SessionMode` keyed by canonical session path.
- Permit mode changes only while a session has no messages; lock on first send.
- Default legacy sessions without metadata to Chat and clean mode metadata on deletion.
- Add the shared session shell and empty-session Chat/Work switch.
- Implement compact conversational Empty Chat and larger brief-oriented Empty Work layouts.
- Add starter prompts that fill the composer without auto-sending.
- Show the workspace folder in Work without introducing Projects.
- Collapse navigation by default only for Empty Chat; keep it one-action expandable and keep active session navigation visible by default.
- Apply the approved typography tokens, minimum text sizes, line heights, and system reading font while preserving existing user font scaling.
- Retain model selection, attachments, voice input, file mention/drop, and composer behavior in both modes.

**Out of scope:**
- Active Work document/result layout.
- Outputs and Sources.
- Selected-text `Ask AI` and `Start writing`.

**Key files/areas likely affected:**
- `agent-sidecar/src/pi-session-store.ts` and tests: mode metadata read/write/default/delete behavior.
- `agent-sidecar/src/commands/handlers/sessions.ts`: mode mutation and snapshot inclusion.
- `src/App.tsx`: mode ownership and first-send lock.
- `src/chat/ChatView.tsx`: shared shell integration while retaining active Chat behavior.
- `src/components/Sidebar.tsx`, `MessageInput.tsx`: empty-mode navigation and composer variants.
- New focused empty-state/mode-switch components under `src/components/` or `src/chat/`.
- `src/App.css` and existing design tokens: typography and layout defaults.

**Dependencies:**
- Phase 2 keyed session state and snapshots.

**Verification:**
- Mode switches freely before the first prompt, locks immediately on send, and survives reload.
- Legacy and corrupt-metadata sessions safely render as Chat.
- Empty Chat and Empty Work match approved headings, composer proportions, starter behavior, and sidebar defaults.
- Default response, user-message, composer, sidebar, code, and secondary text sizes meet the specification at 100% scale.
- Existing font-scale presets, narrow desktop behavior, file input, voice, model selection, steering, and follow-up tests remain green.

**Phase boundary health:** Users receive the improved Chat experience, Work entry point, and readability upgrade. Work sessions may still use the existing active transcript until Phase 4, but mode is truthful, persisted, and never changes an existing conversation.

**Risks:**
- Empty-session detection may disagree between persisted messages and optimistic first send. Lock mode in the same send transaction that creates the first user message.
- Global font changes can overflow dense controls. Use semantic tokens and targeted component adjustments rather than shrinking important text below approved minimums.
- Existing center-input animations may conflict with mode-specific composer sizes. Reuse the existing persistent input and reduced-motion behavior.

**Context notes:** Mode is a session property, not a UI preference. Do not add Projects, plugins, or a mode switch to active transcripts.

---

## Phase 4: Active Work Canvas, Outputs, and Sources

**Outcome:** Active Work sessions render a task-centric document surface with a persistent, responsive Outputs/Sources panel derived consistently from live and persisted session history.

**Why now:** Session mode, concurrency, and readable shell behavior are already stable. This phase can focus on Work presentation and artifact/source safety without changing runtime ownership.

**Scope:**
- Add `WorkSessionView`, task header, document-style result surface, compact user-direction rows, quiet activity progress, and persistent composer.
- Derive outputs from completed write/edit tool calls using existing artifact extraction and preview utilities.
- Derive sources from validated assistant links, structured browse/search results, and attached reference files.
- Apply the approved URL/path normalization, deduplication, display-value, and ordering rules through pure functions.
- Represent multiple writes to one path as one latest output.
- Replace the diagnostic `RightPanel` content with user-facing Work Outputs/Sources.
- Remove the placeholder `DocumentsPanel` after useful presentation is folded into the Work panel.
- Reuse `ArtifactPreview`, open-folder, and copy-path actions.
- Harden missing-file, unsafe-link, sandboxed HTML, and script-bearing SVG behavior.
- Implement wide fixed rail, medium drawer, and narrow mutually exclusive sidebar/panel drawers at the specified breakpoints using CSS layout.
- Preserve background session progress, steering, follow-up, queue editing, and active composer behavior.

**Out of scope:**
- A document editor or direct inline editing of generated files.
- Projects or a separate artifact database.
- Selected-text action menu.

**Key files/areas likely affected:**
- New `WorkSessionView`, `WorkHeader`, `WorkResult`, and `WorkPanel` components.
- `src/components/RightPanel.tsx`, `DocumentsPanel.tsx`: replacement/removal.
- `src/components/ActivityBlock.tsx`, `ArtifactPreview.tsx`, `ToolCallTimeline.tsx`: reuse and safety adjustments.
- `src/lib/artifacts.ts` plus new pure source/output derivation utilities.
- `src/components/MarkdownComponents.tsx`: validated link extraction/opening and preview safety boundaries.
- `src/App.css`: three-column layout and responsive drawers.
- `src/App.tsx` or session shell: choose Chat versus Work active view.

**Dependencies:**
- Phase 3 persisted mode and session shell.
- Phase 2 reliable live/reloaded per-session message state.

**Verification:**
- Live and reloaded copies of one Work session produce identical Outputs and Sources.
- Repeated paths and normalized-equivalent URLs deduplicate according to the spec.
- Code-block URL text, invalid schemes, and unsafe URLs do not become openable Sources.
- Missing files display `File unavailable`; HTML remains sandboxed; SVG scripts cannot execute.
- Wide, medium, and narrow layouts match their defined panel behavior without JavaScript viewport branching.
- Running Work sessions continue when hidden, and their outputs/sources update correctly on return.
- Existing Chat rendering and tool-detail views remain unchanged.

**Phase boundary health:** Chat remains complete, while Work now has its full approved active experience and durable derived rail. No selected-text interaction is required for the core Work workflow.

**Risks:**
- Tool result formats vary by tool/provider. Keep extraction pure, defensive, and limited to known structured data plus existing write/edit paths.
- Artifact preview currently trusts some rendered content. Treat output rendering as a security boundary and test malicious SVG/link cases before exposing the rail.
- Three-column layouts can compress readable lines. Enforce center minimums and switch to drawers at the approved breakpoints.

**Context notes:** Outputs and Sources are projections of messages, never independently persisted entities. Reuse existing artifact utilities before adding parsers.

---

## Phase 5: Selected-text Actions and Release Hardening

**Outcome:** Selecting assistant text offers accessible `Ask AI` and `Start writing` actions that integrate with existing per-session steering/follow-up behavior, and the complete Chat/Work release passes regression and acceptance gates.

**Why now:** Selection actions depend on stable Chat and Work message surfaces, keyed runtime status, and composer queue behavior. Adding them last minimizes interaction regressions during structural layout work.

**Scope:**
- Detect selections wholly contained within one assistant response and position the contextual action menu.
- Add keyboard access, Escape/click/scroll dismissal, focus handling, and selection preservation while activating menu buttons.
- Implement `Ask AI` as a removable quoted composer context without sending.
- Implement `Start writing` as an immediate idle prompt or a running-session follow-up.
- Serialize sent excerpts as readable markdown quotes plus the user's custom instruction or `Start writing` intent.
- Keep Enter steering, `Alt+Enter` follow-up, `Ctrl+↑` queue editing, attachments, model selection, and voice input unchanged.
- Prevent cross-message/sidebar/composer selections and empty excerpts from triggering actions.
- Complete responsive, reduced-motion, accessible-label, error-isolation, and typography regression checks across Chat and Work.
- Measure loaded-session switching against the `100ms` acceptance target and validate multi-session manual flow.

**Out of scope:**
- Rich quote editing, multiple simultaneous excerpts, or a persistent clipping library.
- New actions beyond `Ask AI` and `Start writing`.
- Product areas excluded by the design spec.

**Key files/areas likely affected:**
- `src/components/ChatMessage.tsx`, `src/chat/ChatView.tsx`, and Work result components: selection boundaries and menu anchor.
- New focused `SelectionActions` component/hook.
- `src/components/MessageInput.tsx`: quoted context display and send serialization.
- `src/App.tsx` and keyed stream controller: idle send versus running follow-up routing.
- Component, interaction, accessibility, and regression test files across Chat/Work surfaces.

**Dependencies:**
- Phase 4 complete Chat and Work message surfaces.
- Phase 2 per-session running state and queues.

**Verification:**
- `Ask AI` fills and focuses a quoted draft without sending in both Chat and Work.
- `Start writing` sends while idle and queues only in the selected running session.
- Cross-message and non-assistant selections never show the menu.
- Keyboard, dismissal, focus, and reduced-motion behavior pass component/manual checks.
- Full manual acceptance confirms simultaneous sessions, instant switching, mode persistence, live/reloaded outputs/sources, selection actions, and all responsive layouts.
- Frontend validation, sidecar test/build, Rust format/clippy/tests, and production build pass without warnings.

**Phase boundary health:** This phase completes the approved design. Existing capabilities remain present, and every new interaction has automated coverage plus end-to-end manual acceptance.

**Risks:**
- Browser `Selection` ranges can collapse when the menu takes focus. Preserve the excerpt before focus changes and constrain the menu to one message root.
- Quote serialization can accidentally look like an assistant instruction. Keep the user-visible markdown representation and explicit action text aligned.
- Final regression scope is broad. The detailed plan should prioritize the approved acceptance path and existing tests rather than adding a new end-to-end framework.

**Context notes:** Use native browser selection APIs and existing composer queue paths. Do not add a selection or editor dependency.

---

## Coverage Summary

| Design requirement | Roadmap phase |
|---|---|
| Session-scoped runtime manager and tagged protocol | Phase 1 |
| True concurrent execution and fast cached switching | Phase 2 |
| Sidebar running/error indicators and failure isolation | Phase 2 |
| Chat/Work mode persistence and first-prompt lock | Phase 3 |
| Chat/Work empty states and larger typography | Phase 3 |
| Active Work document surface | Phase 4 |
| Derived Outputs/Sources and secure previews | Phase 4 |
| Responsive Work/sidebar layout | Phase 4 |
| `Ask AI` and `Start writing` selection actions | Phase 5 |
| Full regression, performance, and manual acceptance | Phase 5 |

## Deferred Across All Phases

Projects, plugins/integrations, Library, Agents, Scheduled tasks, cloud session sync, continuation after app exit, a full document editor, and speculative runtime eviction remain outside this roadmap. Add them only through separate approved designs.
