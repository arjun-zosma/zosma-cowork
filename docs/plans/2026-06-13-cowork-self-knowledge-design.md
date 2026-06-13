# Design: Zosma Cowork self-knowledge (progressive disclosure)

Issue: #263 · Branch: `feat/263-cowork-self-knowledge`

## Problem

Cowork overrides pi's system prompt (`systemPromptOverride: () => ZOSMA_SYSTEM_PROMPT`).
pi's `buildSystemPrompt()` only emits its "Pi documentation (read only when…)"
self-knowledge block when **no** `customPrompt` is set, so Cowork loses it.
`ZOSMA_SYSTEM_PROMPT` says nothing about: being a GUI on pi-coding-agent, pi
extensions, skills (skills.sh / Skills panel), or where sessions live. The model
therefore cannot answer "what extensions can you use / where are my sessions /
can you install skills".

## Goal & constraints

- Cowork must *know*, on demand, everything pi knows about itself — adapted to
  the GUI framing ("whatever pi does, Cowork can do").
- **Do not bloat initial-turn context.** The always-on prompt may grow by only a
  few fixed lines. The heavy content loads only when the user asks.

## Approach (chosen): doc pointer + on-demand reference

Mirror pi's own mechanism exactly: a tiny always-on **pointer** + a **reference
file** the `read` tool opens on demand.

1. **Ship a reference doc** `ABOUT-ZOSMA-COWORK.md` and write it to a stable
   absolute path on init: `~/.zosmaai/cowork/ABOUT-ZOSMA-COWORK.md`
   (rewritten every init so it tracks the installed app version). Content:
   - Identity: a desktop GUI built on `pi-coding-agent`; same engine, same
     tools; "whatever pi does, Cowork can do".
   - Extensions: shared with the pi CLI under `~/.pi/agent`; managed via the
     Extensions UI; how to discover/install.
   - Skills: progressive-disclosure skill files; skills.sh as a source; the
     Skills panel; that it can read a `SKILL.md` and follow it.
   - Sessions: stored as JSONL under `~/.zosmaai/cowork/sessions/`, one file per
     session; settings under `~/.zosmaai/cowork/settings.json`.
   - Pointer to pi's own docs (README/docs paths) for deeper pi questions.

2. **Add a short pointer block** to `ZOSMA_SYSTEM_PROMPT` — a Cowork-flavoured
   copy of pi's "read only when the user asks…" line, naming the absolute doc
   path and the trigger topics (capabilities, extensions, skills, sessions,
   "what can you do", "are you pi"). ~5 fixed lines.

### Why not the alternatives
- **Bundled SKILL.md** (B): more native (shows in Skills panel) but needs
  skill-discovery plumbing in the bundled sidecar and a discoverable on-disk
  location; heavier for the same payoff. Revisit later if we want it in the UI.
- **`about_zosma` tool** (C): tool schemas still cost context every turn and it's
  the most code. Rejected.

## Data flow

```
init(zosmaDir)
  └─ writeAboutDoc(zosmaDir)            # writes ABOUT-ZOSMA-COWORK.md (idempotent)
ZOSMA_SYSTEM_PROMPT (static)
  └─ + pointer block naming the doc's absolute path
buildSystemPrompt(customPrompt = ZOSMA_SYSTEM_PROMPT + pointer)
  └─ skills block still auto-appended by pi (unchanged)
user asks "what extensions can you use?"
  └─ model reads ABOUT path via `read` tool → grounded answer
```

## Where the content lives (single source of truth)

The doc body is a string constant in the sidecar (e.g. `about-cowork.ts`,
`ABOUT_COWORK_MD`). On init it is written to the stable path. This avoids a
bundle-resource path-resolution problem (GUI apps don't inherit PATH/cwd) and
guarantees the `read` target always exists and is current.

## Components / changes

- `agent-sidecar/src/about-cowork.ts` (new): `ABOUT_COWORK_MD` constant +
  `writeAboutDoc(zosmaDir): string` returning the absolute path written.
- `agent-sidecar/src/index.ts`:
  - call `writeAboutDoc(zosmaDir)` during `initAgent` (or the init handler);
  - extend `ZOSMA_SYSTEM_PROMPT` with the pointer block (absolute path).
- `agent-sidecar/src/about-cowork.test.ts` (new): assertions below.

## Testing (TDD)

1. `writeAboutDoc` writes the file to `<zosmaDir>/ABOUT-ZOSMA-COWORK.md` and
   returns that absolute path; idempotent (overwrites, no throw on rerun).
2. `ABOUT_COWORK_MD` mentions the four pillars: pi-coding-agent, extensions
   (`~/.pi/agent`), skills (skills.sh), sessions
   (`~/.zosmaai/cowork/sessions`).
3. The pointer block in the built system prompt names the absolute doc path and
   stays small (assert line-count delta is bounded).
4. Identity guarantee preserved: prompt still asserts "Zosma Cowork".

## Acceptance

- Initial context grows only by the fixed pointer block.
- Capability/extension/skill/session questions get accurate grounded answers
  after the model reads the doc.
- Identity answers remain "Zosma Cowork".
