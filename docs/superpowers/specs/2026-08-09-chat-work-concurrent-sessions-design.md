# Chat, Work, and Concurrent Sessions

**Date:** 2026-08-09  
**Status:** Approved design  
**Scope:** Post-login Chat and Work experience

## Problem

Zosma Cowork currently presents every interaction through one transcript-oriented `ChatView`. Empty sessions show a centered composer without explaining whether the user is starting a quick conversation or a sustained task. Completed work remains mixed into the transcript, generated files are buried inside expanded tool details, and no persistent surface shows outputs or sources.

The current interface also uses small defaults: the application root is `13px`, chat markdown is `14px`, and several navigation labels are `10–12px`. Users have reported that the interface is difficult to read.

Finally, Cowork has one live `AgentSession` in the sidecar and one frontend stream reducer. Loading or creating another session aborts and replaces the current session. A user therefore cannot start work in one session, switch to another, and let both continue as they can with separate Pi terminal sessions.

## Reference

The approved UX follows the supplied ChatGPT desktop references:

- Empty Chat uses a compact composer, conversational heading, starter prompts, and reduced navigation.
- Empty Work uses a larger brief-oriented composer, task heading, starter tasks, and expanded history.
- Active Work uses a titled document-like center, fixed composer, and persistent Outputs/Sources rail.
- Selecting assistant text opens `Ask AI` and `Start writing` actions.

The product structure should match these references while retaining Zosma branding and existing capabilities.

## Goals

1. Establish Chat and Work as distinct session modes, not cosmetic tabs.
2. Match the reference information hierarchy for empty Chat, empty Work, and active Work.
3. Raise default typography to a comfortable desktop reading size.
4. Keep multiple loaded sessions alive and allow multiple sessions to run concurrently.
5. Make switching between loaded sessions immediate and show running/error state in the sidebar.
6. Promote generated outputs and supporting sources into a persistent Work rail.
7. Add selected-text `Ask AI` and `Start writing` actions.
8. Preserve file input, voice input, model selection, steering, follow-up queues, session search, and folder-bound workspaces.

## Non-goals

- Projects, plugins, integrations, Library, Agents, or Scheduled tasks.
- Cloud session sync or continuation after the desktop app exits.
- A full document editor.
- A new state-management or UI dependency.
- Automatic eviction of idle loaded sessions in the first version.
- Rebuilding the Pi SDK session persistence format.

## Product Contract

### Session mode

```ts
type SessionMode = "chat" | "work";
```

A new empty session may switch between Chat and Work. Sending its first prompt locks the selected mode to that session. Active sessions do not transform between layouts. Existing sessions without mode metadata open as Chat.

Mode is stored in Cowork's existing sidecar metadata file, keyed by canonical session path:

```text
modes: {
  "/absolute/session/path.jsonl": "work"
}
```

The metadata may be overwritten while the session has zero messages. Deleting a session also removes its mode entry.

### Concurrent sessions

Loading or creating a session must not abort another session. Once loaded, a session remains available in memory until the app closes or the user deletes it. Sessions may prompt models concurrently. Each session owns its runtime state, model, workspace, prompt scheduler, watchdog, queue, and event subscription.

There is no arbitrary product cap on loaded or running sessions in the first version. This deliberately mirrors multiple Pi terminal sessions. Memory pressure should be measured before adding eviction or a concurrency limit.

### App shutdown

Closing the app terminates in-memory runtimes. Pi's normal session persistence remains the durable record. On restart, sessions can be loaded again, but interrupted model/tool execution does not resume automatically.

## User Experience

### Empty Chat

```text
┌──────┬──────────────────────────────────────────────────────┐
│  ＋  │                     [ Chat | Work ]                  │
│  □   │                                                      │
│      │              What's on your mind today?              │
│      │                                                      │
│      │       [ +  Ask Zosma...  Model  Mic  Send ]          │
│      │                                                      │
│      │       • Explain or explore something                 │
│      │       • Help me write                                │
│      │                                                      │
│  ⚙   │                                                      │
└──────┴──────────────────────────────────────────────────────┘
```

Chat is the default mode. Its composer is compact and optimized for a quick question. The history rail may start collapsed on an empty Chat screen, but must remain directly expandable. Starter prompts fill the composer for editing rather than sending automatically.

### Empty Work

```text
┌──────────────────┬───────────────────────────────────────────┐
│ New chat         │                [ Chat | Work ]             │
│                  │                                            │
│ Recent           │          What should we work on?           │
│ Session one      │                                            │
│ Session two      │    ┌──────────────────────────────────┐    │
│                  │    │ Work on anything...              │    │
│                  │    │                                  │    │
│                  │    │ +     Model       Mic      Send   │    │
│                  │    └──────────────────────────────────┘    │
│                  │                                            │
│ Settings         │    • Research and produce a report         │
└──────────────────┴───────────────────────────────────────────┘
```

Work uses a larger multiline composer and task-oriented starter prompts. It shows the current workspace folder without introducing Projects. The sidebar remains expanded by default.

### Active Chat

Active Chat remains transcript-first and keeps the existing composer capabilities. Its typography and spacing adopt the new readable defaults. The session sidebar is visible by default so users can see and switch to running work; users may collapse it manually.

### Active Work

```text
┌──────────────────┬──────────────────────────────┬─────────────┐
│ New chat         │ Task title · Work            │ Outputs     │
│                  ├──────────────────────────────┤ + file      │
│ Recent           │                              ├─────────────┤
│ ◌ Active task    │ Document-style result        │ Sources     │
│   Other task     │                              │ source 1    │
│                  │ Progress shown quietly       │ source 2    │
│                  │                              │             │
│                  ├──────────────────────────────┤             │
│ Settings         │ [ + Work on anything...  ↑ ] │             │
└──────────────────┴──────────────────────────────┴─────────────┘
```

The header shows the task title and `Work` label. Assistant content uses a borderless, document-like reading surface with a maximum readable line width. User directions appear as compact quoted rows rather than dominating the canvas. Tool activity remains visible while running but is secondary to the result. The persistent bottom composer retains steering and follow-up behavior.

The Work rail is present for active Work sessions. On wide windows it is a fixed third column. On medium windows it is collapsible. On narrow windows it becomes a drawer. Empty Outputs or Sources sections show restrained empty states rather than disappearing.

### Sidebar runtime indicators

```text
SESSIONS

◌  Research GPU deployment      Work
   Draft customer email         Chat
◌  Analyze invoices             Work
!  Failed API investigation     Chat
```

- Animated spinner: session is currently running.
- Error icon: session requires attention.
- No status icon: session is idle.
- Active-row styling remains separate from runtime status.
- A collapsed rail shows a running-count badge and can be expanded in one action.

Clicking a loaded row renders its cached state immediately. Clicking a cold persisted session shows a local loading state while that session alone is hydrated. Other sessions continue running.

## Typography

Default sizes at 100% scale:

| Element | Size |
|---|---:|
| Main assistant response | `17px`, `1.65` line-height |
| User message | `16px` |
| Composer | `16px` |
| Empty-state heading | `26px` |
| Task/session header | `16px` |
| Sidebar session title | `14px` |
| Secondary text | `13px` minimum |
| Code | `14px` |
| Buttons and menu items | `14–15px` |

Important interface text must not be smaller than `12px`. The existing user font-scale preference remains supported on top of these defaults. Chat and Work reading surfaces use the native system sans-serif stack, matching the reference's clarity. Zosma display typography may remain in branding-only surfaces.

## Selected-text Actions

Selecting text wholly inside one assistant response opens a contextual menu above the selection:

```text
          ┌─────────────────────────────┐
          │ Ask AI      │ Start writing│
          └─────────────────────────────┘
     highlighted assistant response text
```

Selections crossing messages, the sidebar, or the composer do not open this menu. The menu closes on selection collapse, Escape, scrolling away, or clicking elsewhere. Its buttons are keyboard reachable and do not destroy the selection before the action executes.

### Ask AI

`Ask AI` places the selected excerpt into a removable quote card above the composer and focuses the empty custom-message field. It does not send.

```text
┌─────────────────────────────────────────────────────────┐
│ ↪ “Selected response text…”                         ×   │
├─────────────────────────────────────────────────────────┤
│ Ask a custom question…                    Model  Mic  ↑ │
└─────────────────────────────────────────────────────────┘
```

When idle, Enter sends a normal turn. While the selected session is running, Enter sends a steering message and `Alt+Enter` queues a follow-up, exactly as the composer does today.

### Start writing

`Start writing` immediately submits an instruction to continue writing from the selected excerpt. When idle, it starts a normal turn. While running, it queues a follow-up rather than interrupting the current tool/assistant sub-turn.

The visible persisted user message contains a markdown quote followed by the action or custom instruction. This keeps session history understandable without a second quote persistence format.

## Frontend Architecture

```text
App
├── Sidebar
└── SessionShell
    ├── ModeSwitcher              empty session only
    ├── ChatEmptyState
    ├── WorkEmptyState
    ├── ChatView                  transcript
    └── WorkSessionView
        ├── WorkHeader
        ├── WorkResult
        ├── SelectionActions
        ├── MessageInput
        └── WorkPanel
            ├── Outputs
            └── Sources
```

The current single `usePiStream` state becomes a keyed session-state controller:

```ts
Map<SessionFile, StreamState>
```

One protocol listener receives tagged events and dispatches each event to the reducer for its session. Existing stream reducer behavior should be reused rather than copied. Switching only changes `activeSessionFile`; it does not reset another reducer or send a sidecar rebind/abort command.

A loaded-session snapshot includes persisted messages, current streaming state, queue state, mode, runtime status, model, workspace, and error. Optimistic user messages and queue updates remain scoped to the target session.

## Sidecar Architecture

The current singleton `session`, `sessionManager`, `resourceLoader`, prompt scheduler, and prompt-runner globals become a runtime manager:

```text
SessionRuntimeManager
│
├── session-a.jsonl
│   ├── AgentSession
│   ├── SessionManager
│   ├── ResourceLoader + cwd
│   ├── selected model
│   ├── prompt scheduler
│   ├── watchdog/abort state
│   └── queue/event subscription
│
└── session-b.jsonl
    └── independent equivalents
```

```ts
Map<SessionFile, SessionRuntime>
```

Session paths are canonicalized before lookup so one persisted session cannot acquire duplicate runtimes through path aliases. `load_session` is idempotent: it returns the existing runtime snapshot when already loaded and hydrates exactly once when cold. Concurrent duplicate loads share one in-flight promise.

Auth storage, model registry, and stable global settings may be shared. Agent sessions, session managers, resource loaders, working directories, prompt schedulers, watchdog flags, active prompt IDs, and extension UI bindings are session-scoped. A model selection affects the target session and the default for future sessions, but never mutates another loaded session.

Every agent and session-specific extension event is tagged with its canonical `sessionFile` before entering the relay. Global events such as sidecar readiness remain untagged.

## Protocol

Session-bound commands require `sessionFile`:

```text
prompt(sessionFile, text)
steer(sessionFile, text)
follow_up(sessionFile, text)
abort(sessionFile)
clear_queue(sessionFile)
set_model(sessionFile, provider, model)
```

All envelopes remain JSON Lines on the existing sidecar protocol. `id` correlates a command with its `result`, `error`, and terminal `done` envelope. Session paths are canonical absolute paths, not display labels.

### Wire schemas

The following schemas are the contract between sidecar, Tauri relay, and frontend. Fields marked `?` are omitted when unavailable; arrays are always present when shown.

```ts
type WireSessionStatus = "idle" | "thinking" | "tool_call" | "responding" | "error";

interface SessionSnapshot {
  sessionFile: string;
  mode: "chat" | "work";
  cwd?: string;
  messages: ChatMessage[];
  isRunning: boolean;
  status: WireSessionStatus;
  queue: { steering: string[]; followUp: string[] };
  model?: { provider?: string; id?: string };
  error?: { code: string; message: string; retryable: boolean };
}

interface SessionEventEnvelope {
  type: "event";
  sessionFile: string;
  event: PiEvent;
}

interface SessionMutationResult {
  success: true;
  sessionFile: string;
}

interface SessionResultEnvelope {
  type: "result";
  id: string;
  sessionFile?: string;
  data: SessionSnapshot | SessionMutationResult;
}

type SessionErrorCode =
  | "session_not_loaded"
  | "session_load_failed"
  | "session_busy"
  | "session_aborted"
  | "provider_error";

interface SessionErrorEnvelope {
  type: "error";
  id: string;
  sessionFile?: string;
  code: SessionErrorCode;
  message: string;
  retryable: boolean;
  details?: string;
}
```

`new_session` and `load_session` always return a complete `SessionSnapshot`; a new empty session uses `messages: []`, `isRunning: false`, `status: "idle"`, and empty queues. Session metadata mutations may return `SessionMutationResult`. A session-bound command targeting a missing runtime returns `session_not_loaded`; it must never silently fall back to whichever session was most recently viewed. `done` is emitted only after the command's side effect and response have completed.

The Tauri relay remains thin. It forwards session identity and emits tagged events without owning session runtime state.

## Outputs and Sources

Outputs and sources are derived from persisted/live messages. Cowork does not introduce a parallel artifact database.

```text
Session messages
      │
      ├── completed write/edit tool calls
      │         └── Outputs: deduplicated canonical file paths
      │
      └── markdown links, browsing results, attached references
                └── Sources: deduplicated URLs and files
```

Pure derivation functions provide identical results for live and reloaded sessions:

- Outputs come from completed write/edit tool calls using the existing artifact path extraction logic.
- Multiple writes to the same path produce one output row representing the latest state.
- Sources come from validated external links in assistant markdown, structured browsing/search results, and attached input files.
- URLs and paths are normalized before deduplication.
- Arbitrary URL-like text inside code blocks is not treated as a source.

Selecting an output opens the existing `ArtifactPreview` when supported or offers its existing open-folder/path actions. HTML remains sandboxed. SVG previews must not execute embedded scripts. External sources use the existing validated external-link path.

The existing placeholder-only `DocumentsPanel` is removed after any useful presentation is folded into `WorkPanel`; it does not remain as a second source of truth.

## Runtime Data Flow

```text
Agent A ── event(session=A) ──┐
Agent B ── event(session=B) ──┼── Tauri relay ── frontend state map
Agent C ── event(session=C) ──┘

Viewing A ── click B ──→ render cached B state
    │
    └── A continues streaming and persisting in background
```

Each session serializes its own prompts and steering/follow-up queue. Different sessions may run in parallel. Provider-level rate limiting may affect several sessions externally, but errors and UI state remain associated with the session that received them.

## Responsive Breakpoints

These are layout breakpoints, not feature gates:

- **Wide (`>=1280px` content viewport):** expanded sidebar (`288px`), center Work result, and visible Outputs/Sources rail (`304px`).
- **Medium (`768–1279px`):** expanded sidebar (`288px`) and center result; Work panel is closed by default and opens as a right drawer no wider than `320px`.
- **Narrow (`<768px`):** sidebar and Work panel are drawers; only one drawer may be open at a time. The center result and composer remain full width. The Chat/Work switch remains visible in the center header.

The implementation must use CSS media queries/container-safe layout rather than JavaScript viewport checks for static layout. Switching sessions, running streams, selection actions, and queue behavior are identical at every breakpoint. Reduced motion disables drawer and panel transitions.

## Source and Path Normalization

Normalization is used only for identity/deduplication; the original display value is retained for the user.

- **URLs:** parse with `URL`; accept only `http:` and `https:` as persistent Sources. Lowercase the hostname, remove default ports, remove the fragment, and remove a trailing slash except for the root path. Preserve path case, query parameters, and meaningful percent-encoding. Invalid URLs and non-http schemes remain text and are never opened from the Sources rail.
- **File paths:** the sidecar resolves relative tool paths against that session's `cwd` and emits an absolute normalized path. For frontend comparison, replace `\\` with `/`, preserve a leading UNC `//`, collapse repeated separators after that prefix, uppercase a Windows drive letter, and remove a trailing separator except for `/`, `C:/`, or a UNC share root. Do not lowercase the remaining path because case sensitivity varies by workspace/platform.
- **Deduplication:** compare normalized URL strings and normalized path strings separately. The newest output/source record owns its display title and metadata; ordering follows first appearance in the session unless the user explicitly sorts later.

Each source/output keeps both `identity` (normalized) and `displayValue` (original) so normalization never changes what the user sees.

## Error Handling

- A session error updates only that session's state and sidebar indicator.
- Switching or loading failure does not abort or reset another runtime.
- Aborting session A cannot affect session B.
- Rapid repeated selection of a cold session cannot create duplicate runtimes.
- Deleting a running session requires an explicit `Stop and delete` confirmation; stop completes before persisted deletion.
- Sidecar loss marks all running sessions interrupted. Persisted sessions remain reloadable after readiness returns.
- Missing output files display `File unavailable` and retain safe path actions where possible.
- Invalid or unsafe source URLs render as text and are never opened.
- Output/source derivation failure leaves the relevant panel section empty and does not break the transcript.
- Selection actions never send an empty excerpt.
- Existing user-friendly provider/model errors remain visible per session.

## Accessibility and Interaction

- Chat/Work switch uses a labeled tab or segmented-control pattern with keyboard navigation and clear selected state.
- Selection-action menu supports keyboard focus and Escape.
- Sidebar runtime state is conveyed by icon, text/accessible label, and animation—not color alone.
- Animated indicators and layout transitions respect reduced-motion preference.
- Composer, rail controls, and panel toggles retain visible focus rings.
- The reading-size defaults apply without requiring users to discover font settings.

## Testing Strategy

Production changes follow repository TDD rules: add or update a failing test first, verify the expected failure, then implement the minimum behavior.

### Sidecar unit/integration tests

- Two fake agent sessions stream concurrently.
- Events are tagged and delivered to the correct session.
- Aborting A leaves B running.
- Per-session prompt schedulers serialize within a session but run across sessions.
- Steering, follow-up, and clear-queue operations remain isolated.
- Session-specific model changes do not mutate another runtime.
- Duplicate concurrent loads create one runtime.
- Mode metadata defaults, updates, and deletion cleanup are correct.
- Corrupt legacy metadata still falls back safely.

### Frontend reducer/hook tests

- Tagged events update only the addressed `StreamState`.
- Switching the active key does not reset hidden running state.
- Hidden session completion is retained and shown on return.
- Optimistic prompts and queues stay session-scoped.
- Sidecar loss marks only previously running sessions interrupted.

### Component tests

- Mode may change before the first prompt and locks afterward.
- Existing sessions without mode metadata render as Chat.
- Empty Chat and Work render their approved headings, composer sizes, and starters.
- Active Work renders task title, result surface, and Work panel.
- Sidebar shows running and error indicators with accessible labels.
- `Ask AI` fills a removable quoted draft without sending.
- `Start writing` sends while idle and queues while running.
- Existing Enter steering, `Alt+Enter` follow-up, and `Ctrl+↑` queue editing remain unchanged.
- Outputs and sources derive, normalize, and deduplicate correctly.
- Missing files and invalid URLs fail safely.
- Typography tokens meet approved minimums.
- Work panel responds as column, collapsible rail, and drawer at defined breakpoints.

### Relay tests

- Tauri forwards `sessionFile` on session-bound commands and events.
- Untagged global events remain compatible.
- Structured session errors are preserved.

### Manual acceptance

```text
Start Work A → switch to Chat B → start B
→ both sidebar spinners animate
→ return to A immediately
→ steer A
→ B continues unchanged
```

Also verify session reload, output/source restoration, mode restoration, selection actions, narrow-window Work panel behavior, reduced motion, and all supported font scales.

## Performance and Acceptance Criteria

- Main response text defaults to `17px`; important UI text is never below `12px`.
- A loaded-session switch renders cached state within `100ms` and performs no backend reload.
- Switching never aborts background work.
- Multiple sessions can stream simultaneously without event crossover.
- Every session-bound command and event carries explicit session identity.
- Mode locks after the first prompt and survives reload.
- Outputs and sources derive consistently from live and persisted history.
- `Ask AI` quotes without sending.
- `Start writing` sends or queues according to runtime state.
- Existing steering, follow-up, queue editing, attachments, voice input, model selection, and deep session search continue to work.
- Visual hierarchy matches the supplied references while using Zosma branding.
- Frontend tests, sidecar type checking/tests, Tauri tests, lint, and production build pass without warnings.

## Existing Code Reused

- `src/chat/ChatView.tsx` and its stream rendering behavior.
- `src/components/MessageInput.tsx` steering/follow-up and attachment controls.
- `src/components/ActivityBlock.tsx` for quiet execution progress.
- `src/components/ArtifactPreview.tsx` and `src/lib/artifacts.ts` for output discovery/preview.
- `src/components/RightPanel.tsx` as the starting shell for the Work rail, with diagnostics replaced by user-facing Outputs/Sources.
- `src/components/Sidebar.tsx` and `ConversationSearch.tsx` for session retrieval and row actions.
- `agent-sidecar/src/pi-session-store.ts` and `cowork-meta.json` for mode metadata.
- Pi `SessionManager` persistence and `AgentSession` queue behavior.

## Architectural Decomposition

This design is too large for one implementation plan. After spec approval it should move to a phased roadmap with these boundaries:

1. Concurrent sidecar runtime manager and tagged protocol.
2. Frontend keyed stream state, fast switching, and sidebar runtime indicators.
3. Session mode persistence and Chat/Work empty states.
4. Active Work canvas with Outputs/Sources.
5. Typography and selected-text actions, followed by full regression validation.

Each phase must leave existing single-session behavior usable until the keyed runtime path is complete. UI work must not ship a fake background-running indicator before true sidecar concurrency exists.
