# Browser Harness Research for Zosma Cowork

> Research date: 2026-06-16
> Goal: Give zosma-cowork agentic browsing — the agent can open a browser, navigate, extract info, and return results to the user.

---

## Zosma Cowork Architecture (Context)

- **Tauri v2** desktop app (Rust backend + React 19 frontend)
- **Agent sidecar**: Node.js process using `@earendil-works/pi-coding-agent`
- **Extension-based tooling**: Tools registered via extensions with `tools: [{name, description}]` arrays
- **No browser deps yet** — clean slate

---

## Landscape Overview

### Tier 1: Full Autonomous Agent Frameworks (Python-heavy)

These are full LLM-driven browser agents. The LLM decides what to click, type, scroll, etc.

| Tool | Language | Stars | Approach | Pros | Cons |
|------|----------|-------|----------|------|------|
| **browser-use** | Python/TS | 95k+ | Single `Agent` class orchestrates LLM + Chromium via CDP | Most popular, well-documented, cloud option (Browserbase) | Python-heavy, heavy deps, Docker issues with `--no-sandbox` |
| **Stagehand** (Browserbase) | TypeScript | ~15k | V3 layered architecture: `act`, `extract`, `observe`, `agent()` | TS-native, Browserbase cloud integration, "Understudy" CDP layer | Tied to Browserbase ecosystem, commercial cloud focus |
| **Magentic-UI** (Microsoft) | Python | ~12k | Multi-agent: WebSurfer + Coder + orchestrator | Research-grade, proven multi-agent patterns | Overkill, Python-only, research prototype not production-ready |
| **Webwright** (Microsoft) | Python | ~3k | Terminal-native, re-runnable scripts, no persistent sessions | Clean design, scripts stay in code file, no session drift | Python-only, no persistent browser state |
| **OpenSteer** | Python | ~2k | Python-native browser automation for AI agents | Lightweight, Python-first | Small ecosystem, early stage |

### Tier 2: CLI-First & Token-Efficient Tools

These output compact text (accessibility tree snapshots) to minimize LLM token usage. Perfect for agent integration.

| Tool | Language | Approach | Pros | Cons |
|------|----------|----------|------|------|
| **agent-browser** | **Rust** | Native CLI, accessibility-first semantics, compact text output | **Rust binary = zero deps**, token-efficient, agent-first design, Vercel-backed | Newer tool, smaller ecosystem |
| **chrome-devtools-cli** | Node.js | Zero-config CDP CLI, no MCP server needed | Direct CDP, no extra server, lightweight | Node.js dep, limited feature set |
| **hubcap / cdp-cli** | Various | Direct terminal access to CDP | Scriptable, direct protocol access | Manual CDP protocol work |

### Tier 3: MCP Servers (Structured Browser Access)

These run as MCP servers and expose browser tools via the Model Context Protocol.

| Tool | Approach | Pros | Cons |
|------|----------|------|------|
| **Playwright MCP** (Microsoft) | Accessibility snapshots (not screenshots) | Production-grade, no vision model needed, fast/deterministic | Requires MCP client, Playwright install |
| **unibrowse** | Chrome extension + 70+ tools, multi-tab, intelligent delegation | Rich toolset, multi-tab | Chrome extension required, complex setup |
| **agent-browse** | Stateful MCP server, persists sessions across calls, experimental CLI for Firefox via WebSocket | Session persistence, Firefox option | Experimental, Firefox-only CLI |

### Tier 4: Stealth/Anti-Detection Browsers

For scraping sites that block automation.

| Tool | Approach | Pros | Cons |
|------|----------|------|------|
| **Camoufox** | Headless Firefox fork, C++ fingerprint injection, Playwright-compatible | Undetectable, small memory, drop-in Playwright | Firefox-only, niche use case |
| **fox-pilot** | Experimental stealth automation | Firefox-based | Explicitly experimental, bugs |

---

## What Competitors Are Doing

### Cursor IDE (Cursor 2.0)
- **Built-in Chromium browser** via CDP
- Agent "sees" page as a **clean, bulleted outline** (accessibility tree)
- Supports **visual editor** — direct CSS/layout manipulation
- Agent can debug, audit accessibility, visually edit layouts
- **Key insight**: They don't use screenshots — accessibility tree only

### Windsurf IDE
- **"Previews" view** — local web apps rendered in-editor
- Users select elements, capture console errors, feed to Cascade agent
- **Deprecated standalone browser tool** (Sept 2025) in favor of Previews
- **Key insight**: They moved away from general browsing to local dev previews

### OpenHands
- Integrates **browser-use** for web browsing
- Agent can read documentation, browse web autonomously
- **Key insight**: GPT-4 usually required for reasonable results due to web complexity
- Known issue: `--no-sandbox` flag needed in Docker

### Devin (Cognition)
- Proprietary browser integration (not open-sourced)
- Full autonomous browsing with screenshots + DOM

---

## Architecture Patterns

### Pattern A: Accessibility Tree Only (Cursor-style)
```
Agent → CDP → Accessibility Tree → Clean text outline → LLM
```
- **Pros**: Token-efficient, no vision model, fast, deterministic
- **Cons**: Can't see visual layout, images, charts
- **Tools**: Playwright MCP, agent-browser, Cursor's built-in

### Pattern B: Screenshots + Accessibility (Hybrid)
```
Agent → CDP → Screenshot + Accessibility Tree → LLM (vision + text)
```
- **Pros**: Full context, can see visual elements
- **Cons**: Expensive (vision model), slower, more tokens
- **Tools**: browser-use, Stagehand

### Pattern C: Full Autonomous Agent
```
User → LLM decides actions → CDP executes → loop
```
- **Pros**: Truly autonomous, can handle complex multi-step browsing
- **Cons**: Many LLM calls, slow, expensive
- **Tools**: browser-use, Stagehand, Magentic-UI

---

## Recommendations for Zosma Cowork

### 🏆 Top Pick: agent-browser (Rust CLI)

**Why it's the best fit:**
1. **Rust binary** — zosma-cowork is already a Tauri/Rust app. Can bundle as a sidecar binary (like the existing sidecar pattern).
2. **Zero runtime deps** — no Node.js/Python needed.
3. **Token-efficient** — accessibility-first output, compact text.
4. **Agent-first design** — built specifically for LLM agents, not humans.
5. **Vercel-backed** — active development, good documentation.
6. **CLI interface** — easy to invoke from the agent sidecar via shell commands or IPC.

**Integration approach:**
```
zosma-cowork (Tauri) → agent-sidecar (Node.js) → agent-browser (Rust CLI) → Chromium
```

As a Tauri sidecar binary, it would:
- Ship with the app (no install step)
- Be invoked via `@tauri-apps/plugin-shell`
- Return compact accessibility snapshots to the LLM

### 🥈 Alternative: Playwright MCP

**If we want MCP-based integration:**
1. **Microsoft-backed** — production-grade.
2. **Accessibility snapshots** — no vision model needed.
3. **MCP protocol** — clean tool interface.

**Integration approach:**
- Run Playwright MCP as a child process
- Connect via stdio MCP transport
- Use accessibility snapshot tools

**Downside**: Requires Playwright Chromium install + MCP client infrastructure.

### 🥉 Lightweight: Direct CDP via chrome-devtools-cli

**If we want minimal deps:**
1. **Zero-config** — just needs Chrome installed.
2. **Direct CDP** — no abstraction layers.
3. **Lightweight** — small Node.js package.

**Downside**: Need to implement tool logic ourselves (click, type, snapshot, etc.).

---

## What NOT to Use

- **browser-use** — Python-heavy, Docker issues, overkill for our use case. Would need a Python sidecar.
- **Stagehand** — Tied to Browserbase ecosystem, commercial focus.
- **Magentic-UI** — Research prototype, Python-only, multi-agent overkill.
- **Camoufox** — Only needed for anti-detection scraping, not general browsing.

---

## Next Steps

1. **Prototype with agent-browser** — install, test CLI commands, measure token output.
2. **Design tool interface** — what commands does the LLM need? (navigate, click, type, extract, screenshot?)
3. **Bundle as Tauri sidecar** — follow the existing sidecar pattern.
4. **Register as extension** — follow the `tools: [{name, description}]` pattern.
5. **Test with real browsing tasks** — research queries, form filling, data extraction.

---

## Key Design Decisions to Make

1. **Accessibility tree only vs hybrid (screenshot + tree)** — start with tree-only (token-efficient), add screenshots if needed.
2. **Persistent browser vs ephemeral** — persistent session saves auth state but can drift. Start ephemeral.
3. **Autonomous agent vs tool-assisted** — start with tool-assisted (LLM calls browser tools), add autonomous mode later.
4. **Local Chrome vs bundled Chromium** — local Chrome is simpler; bundled Chromium guarantees version.
