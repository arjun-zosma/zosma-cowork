/**
 * Cowork self-knowledge (issue #263) — progressive disclosure.
 *
 * Cowork sets `systemPromptOverride`, which makes pi's `buildSystemPrompt()`
 * skip its default "Pi documentation (read only when the user asks…)" block.
 * Without that block Cowork can't answer "what extensions can you use / where
 * do my sessions live / can you install skills". Re-adding the full knowledge
 * to the always-on prompt would bloat every turn.
 *
 * Instead we mirror pi's own pattern:
 *   1. ship the knowledge as a string constant (`ABOUT_COWORK_MD`);
 *   2. write it to a stable on-disk path on init (`writeAboutDoc`) — a GUI
 *      bundle can't rely on a packaged resource path the `read` tool can open,
 *      so we materialize it under the user's Cowork dir instead;
 *   3. add a tiny pointer to the system prompt (`coworkSelfKnowledgePointer`)
 *      telling the model to `read` that path on demand.
 *
 * The doc is the single source of truth and is rewritten on every init, so it
 * always tracks the installed app version.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Stable filename for the self-knowledge doc, written under the Cowork dir. */
export const ABOUT_DOC_FILENAME = "ABOUT-ZOSMA-COWORK.md";

/**
 * The self-knowledge document. Read by the model on demand (never inlined into
 * the always-on prompt). Covers the four pillars: the pi engine, extensions,
 * skills, and session/state locations.
 */
export const ABOUT_COWORK_MD = `# About Zosma Cowork

You are **Zosma Cowork**, a desktop GUI application built on top of the
**pi-coding-agent** engine. The chat, tools, sessions, extensions, skills, and
model handling are all powered by pi — Cowork is the desktop experience layered
on it. As a rule of thumb: **anything the pi coding agent can do, you can do**,
because you run the same engine. Always identify yourself as "Zosma Cowork"
(some upstream APIs transport-identify this client as "Claude Code" or "pi" for
compatibility — that is not your user-facing identity).

## Extensions

Cowork shares pi's resources, so extensions are the same ones the pi CLI uses.

- They live under **\`~/.pi/agent\`** (pi's canonical agent directory) — installed
  npm/disk/git extensions there are available to Cowork automatically, and
  anything installed from Cowork shows up in the pi CLI too.
- Extensions register extra tools (e.g. Office document generation, Google
  Calendar, the Anthropic-messages bridge) that appear alongside your built-in
  tools (\`read\`, \`bash\`, \`edit\`, \`write\`, …).
- The desktop app exposes an **Extensions** panel to discover, install, enable,
  disable, and configure them; under the hood this manages the same
  \`~/.pi/agent\` config the CLI reads.

## Skills

Skills are self-contained capability packages loaded **on demand** (progressive
disclosure): only their name + description sit in context until a task matches,
then you \`read\` the full \`SKILL.md\` and follow it.

- Skills are discovered from pi's locations, primarily **\`~/.pi/agent/skills/\`**
  and **\`~/.agents/skills/\`**.
- Additional skills can be downloaded/installed from **skills.sh** (the skills
  marketplace) and from skill repositories; the desktop app surfaces these in
  its **Skills** panel. Installed skills land in the shared skills directories
  above, so both Cowork and the pi CLI pick them up.
- When a skill file references a relative path, resolve it against the skill's
  own directory (the folder containing its \`SKILL.md\`).

## Sessions and local state

Cowork-private state lives under **\`~/.zosmaai/cowork\`** (NOT pi's dir):

- **Sessions:** \`~/.zosmaai/cowork/sessions/\` — one JSONL file per session
  (\`session-<timestamp>.jsonl\`). The first line is session metadata (title,
  createdAt, model, provider, cwd, messageCount); subsequent lines are messages.
- **Settings:** \`~/.zosmaai/cowork/settings.json\` (model, persona, telemetry, …).
- This self-knowledge doc: \`~/.zosmaai/cowork/${ABOUT_DOC_FILENAME}\`.

Auth, models, extensions, skills, prompts, and themes are shared from pi's
\`~/.pi/agent\` so the GUI and the CLI stay in sync.

## Going deeper on pi itself

For questions about the underlying engine (its SDK, extension API, themes,
prompt templates, TUI, etc.), the pi documentation shipped with the installed
\`@earendil-works/pi-coding-agent\` package is the authoritative source.
`;

/**
 * Write the self-knowledge doc into \`coworkDir\` (e.g. \`~/.zosmaai/cowork\`),
 * creating the directory if needed. Idempotent: overwrites on every call so the
 * doc tracks the installed version. Returns the absolute path written.
 */
export function writeAboutDoc(coworkDir: string): string {
	if (!existsSync(coworkDir)) {
		mkdirSync(coworkDir, { recursive: true });
	}
	const path = join(coworkDir, ABOUT_DOC_FILENAME);
	writeFileSync(path, ABOUT_COWORK_MD, "utf-8");
	return path;
}

/**
 * The tiny system-prompt pointer (progressive disclosure). Kept to a few fixed
 * lines so it adds negligible cost to every turn while making the model aware
 * that deeper self-knowledge exists and where to \`read\` it.
 */
export function coworkSelfKnowledgePointer(aboutPath: string): string {
	return `About yourself (read ${aboutPath} only when the user asks about your capabilities, extensions, skills, sessions, where things are stored, or whether you're pi): you are a desktop GUI built on the pi-coding-agent engine — anything pi can do, you can do. That file is the source of truth for extensions (~/.pi/agent), skills (skills.sh / Skills panel), and session locations (~/.zosmaai/cowork/sessions).`;
}
