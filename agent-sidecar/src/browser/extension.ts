/**
 * Zosma Cowork — Agentic Browser Extension (Phase 0)
 *
 * Registers six agent-browser-backed tools into the pi agent session:
 *   browser_navigate, browser_snapshot, browser_click,
 *   browser_type, browser_extract, browser_close
 *
 * Backed by vercel-labs/agent-browser (native Rust CLI, accessibility-first).
 * The LLM receives only compact text snapshots; the live-viewport "little
 * screen" UX is Phase 1 (CDP screencast streamed to the human, never the model).
 *
 * Loaded by DefaultResourceLoader via extensionFactories in index.ts, alongside
 * zosmaOfficeDocs / zosmaGoogleCalendar.
 *
 * Roadmap: docs/plans/2026-06-16-browser-harness-plan.md
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createClickTool,
	createCloseTool,
	createExtractTool,
	createNavigateTool,
	createSnapshotTool,
	createTypeTool,
} from "./tools.js";

export default async function zosmaBrowser(pi: ExtensionAPI): Promise<void> {
	// ── Navigation & reading ────────────────────────────────────────────
	pi.registerTool(createNavigateTool());
	pi.registerTool(createSnapshotTool());
	pi.registerTool(createExtractTool());

	// ── Interaction ─────────────────────────────────────────────────────
	pi.registerTool(createClickTool());
	pi.registerTool(createTypeTool());

	// ── Lifecycle ───────────────────────────────────────────────────────
	pi.registerTool(createCloseTool());
}
