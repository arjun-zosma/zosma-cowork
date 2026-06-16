/**
 * Browser tool definitions (Phase 0)
 *
 * Six thin pi tools wrapping the agent-browser CLI via AgentBrowserExecutor:
 *   browser_navigate, browser_snapshot, browser_click,
 *   browser_type, browser_extract, browser_close
 *
 * The LLM only ever sees the compact accessibility-tree text + ref ids — never
 * screenshots (those are a Phase 1 concern, streamed to the human UI in
 * parallel and never sent to the model).
 *
 * See docs/plans/2026-06-16-browser-harness-plan.md for the phased roadmap.
 */

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import {
	AgentBrowserError,
	getAgentBrowserExecutor,
} from "./agent-browser-executor.js";

// ─── Shared helpers ──────────────────────────────────────────────────

type ToolResult = {
	content: { type: "text"; text: string }[];
	// AgentToolResult requires `details` to be present (type T, default unknown).
	details: unknown;
	// `isError` is honored by the runtime/renderer (see office-docs tools); it is
	// an extra optional field relative to the bare AgentToolResult type, which is
	// fine for type-to-type assignment.
	isError?: boolean;
};

function ok(text: string, details: unknown = {}): ToolResult {
	return { content: [{ type: "text", text }], details };
}

function fail(text: string, details: unknown = {}): ToolResult {
	return { content: [{ type: "text", text }], details, isError: true };
}

/** Map an executor exception into a tool error result (never throws). */
function guard(fn: () => ToolResult): ToolResult {
	try {
		return fn();
	} catch (err) {
		if (err instanceof AgentBrowserError) {
			return fail(`Browser error (${err.code}): ${err.message}`, {
				code: err.code,
			});
		}
		return fail(
			`Unexpected browser error: ${(err as Error).message ?? String(err)}`,
		);
	}
}

// ─── browser_navigate ────────────────────────────────────────────────

const NavigateParams = Type.Object({
	url: Type.String({
		description:
			"URL to open. A scheme is added if missing (example.com -> https://example.com).",
	}),
});
export type TNavigateParams = Static<typeof NavigateParams>;

export function createNavigateTool(): ToolDefinition<typeof NavigateParams> {
	return {
		name: "browser_navigate",
		label: "Browse: Navigate",
		description: [
			"Open a URL in the agent's headless browser and return the page title + final URL.",
			"Starts (or reuses) a browser session. Follow with browser_snapshot to see the page.",
			"",
			'Example: browser_navigate({ url: "https://news.ycombinator.com" })',
		].join("\n"),
		promptSnippet: "Open a web page in the agent's headless browser.",
		promptGuidelines: [
			"Use browser_navigate first, then browser_snapshot to read the page.",
			"Re-snapshot after any action that changes the page.",
			"Call browser_close when finished to free the browser.",
		],
		parameters: NavigateParams,
		execute: async (_id, params) =>
			guard(() => {
				const url = withScheme(params.url);
				const res = getAgentBrowserExecutor().open(url);
				if (!res.success || !res.data) {
					return fail(`Failed to open ${url}: ${res.error ?? "unknown error"}`, {
						url,
						error: res.error,
					});
				}
				return ok(
					`Opened "${res.data.title}"\nURL: ${res.data.url}\n\nNext: call browser_snapshot to read the page.`,
					res.data,
				);
			}),
	};
}

// ─── browser_snapshot ────────────────────────────────────────────────

const SnapshotParams = Type.Object({
	interactive: Type.Optional(
		Type.Boolean({
			description:
				"Only interactive elements (links/buttons/inputs) with refs. Default true — token-efficient.",
		}),
	),
	urls: Type.Optional(
		Type.Boolean({
			description: "Include link target URLs (only with interactive). Default false.",
		}),
	),
});
export type TSnapshotParams = Static<typeof SnapshotParams>;

export function createSnapshotTool(): ToolDefinition<typeof SnapshotParams> {
	return {
		name: "browser_snapshot",
		label: "Browse: Snapshot",
		description: [
			"Capture the current page as a compact accessibility tree with element refs (@e1, @e2…).",
			"Use the refs with browser_click / browser_type / browser_extract.",
			"interactive=true (default) returns only actionable elements; set false for the full tree.",
		].join("\n"),
		promptSnippet: "Read the current page as a ref-annotated accessibility tree.",
		promptGuidelines: [
			"Always snapshot before acting so refs are fresh.",
			"Refs change after navigation or DOM updates — re-snapshot, don't reuse old refs.",
		],
		parameters: SnapshotParams,
		execute: async (_id, params) =>
			guard(() => {
				const res = getAgentBrowserExecutor().snapshot(
					params.interactive ?? true,
					params.urls ?? false,
				);
				if (!res.success || !res.data) {
					return fail(
						`Snapshot failed: ${res.error ?? "no active page — call browser_navigate first"}`,
						{ error: res.error },
					);
				}
				const refCount = Object.keys(res.data.refs ?? {}).length;
				return ok(
					`${res.data.snapshot}\n\n(${refCount} interactive element${refCount === 1 ? "" : "s"})`,
					res.data,
				);
			}),
	};
}

// ─── browser_click ───────────────────────────────────────────────────

const ClickParams = Type.Object({
	ref: Type.String({
		description:
			'Element ref from a snapshot (e.g. "e2" or "@e2"). A CSS selector or role query also works.',
	}),
});
export type TClickParams = Static<typeof ClickParams>;

export function createClickTool(): ToolDefinition<typeof ClickParams> {
	return {
		name: "browser_click",
		label: "Browse: Click",
		description: [
			"Click an element by its snapshot ref (e.g. @e2) or a CSS selector.",
			"If a banner/modal covers the target the click fails early — dismiss it, re-snapshot, retry.",
			"Re-snapshot afterwards to see the resulting page state.",
		].join("\n"),
		promptSnippet: "Click an element by ref or selector.",
		promptGuidelines: [
			"Get the ref from a fresh browser_snapshot first.",
			"After clicking, re-snapshot — the page (and refs) likely changed.",
		],
		parameters: ClickParams,
		execute: async (_id, params) =>
			guard(() => {
				const res = getAgentBrowserExecutor().click(params.ref);
				if (!res.success) {
					return fail(`Click failed on ${params.ref}: ${res.error ?? "unknown error"}`, {
						ref: params.ref,
						error: res.error,
					});
				}
				return ok(
					`Clicked ${params.ref}. Call browser_snapshot to see the new page state.`,
					res.data ?? undefined,
				);
			}),
	};
}

// ─── browser_type ────────────────────────────────────────────────────

const TypeParams = Type.Object({
	ref: Type.String({
		description: 'Input/field ref from a snapshot (e.g. "e3" or "@e3"), or a CSS selector.',
	}),
	text: Type.String({ description: "Text to type into the field." }),
});
export type TTypeParams = Static<typeof TypeParams>;

export function createTypeTool(): ToolDefinition<typeof TypeParams> {
	return {
		name: "browser_type",
		label: "Browse: Type",
		description: [
			"Type text into an input/textarea by its snapshot ref (e.g. @e3) or a CSS selector.",
			"Use browser_snapshot to find the field ref first.",
		].join("\n"),
		promptSnippet: "Type text into a form field by ref or selector.",
		promptGuidelines: [
			"Snapshot first to get the field ref.",
			"To submit, click the submit button (browser_click) after typing.",
		],
		parameters: TypeParams,
		execute: async (_id, params) =>
			guard(() => {
				const res = getAgentBrowserExecutor().fill(params.ref, params.text);
				if (!res.success) {
					return fail(`Type failed on ${params.ref}: ${res.error ?? "unknown error"}`, {
						ref: params.ref,
						error: res.error,
					});
				}
				return ok(`Typed into ${params.ref}.`, res.data ?? undefined);
			}),
	};
}

// ─── browser_extract ─────────────────────────────────────────────────

const ExtractParams = Type.Object({
	ref: Type.Optional(
		Type.String({
			description:
				"Optional element ref (e.g. @e1) or selector to read text from. Omit for the whole page.",
		}),
	),
});
export type TExtractParams = Static<typeof ExtractParams>;

export function createExtractTool(): ToolDefinition<typeof ExtractParams> {
	return {
		name: "browser_extract",
		label: "Browse: Extract Text",
		description: [
			"Read text content from the page. Pass a ref/selector for one element, or omit it",
			"to get the full readable accessibility text of the page.",
		].join("\n"),
		promptSnippet: "Extract readable text from the page or a specific element.",
		promptGuidelines: [
			"Use this to read article/body text after navigating.",
			"For a targeted read, pass a ref from browser_snapshot.",
		],
		parameters: ExtractParams,
		execute: async (_id, params) =>
			guard(() => {
				const exec = getAgentBrowserExecutor();
				if (params.ref) {
					const res = exec.getText(params.ref);
					if (!res.success) {
						return fail(
							`Extract failed on ${params.ref}: ${res.error ?? "unknown error"}`,
							{ ref: params.ref, error: res.error },
						);
					}
					return ok(textOf(res.data), res.data ?? undefined);
				}
				// Whole-page: full (non-interactive) accessibility tree as readable text.
				const res = exec.snapshot(false, false);
				if (!res.success || !res.data) {
					return fail(
						`Extract failed: ${res.error ?? "no active page — call browser_navigate first"}`,
						{ error: res.error },
					);
				}
				return ok(res.data.snapshot, { origin: res.data.origin });
			}),
	};
}

// ─── browser_close ───────────────────────────────────────────────────

const CloseParams = Type.Object({});
export type TCloseParams = Static<typeof CloseParams>;

export function createCloseTool(): ToolDefinition<typeof CloseParams> {
	return {
		name: "browser_close",
		label: "Browse: Close",
		description:
			"Close the agent's browser session and free resources. Call when finished browsing.",
		promptSnippet: "Close the agent's browser session.",
		promptGuidelines: ["Always close the browser when the browsing task is done."],
		parameters: CloseParams,
		execute: async () =>
			guard(() => {
				const res = getAgentBrowserExecutor().close();
				if (!res.success) {
					return fail(`Close failed: ${res.error ?? "unknown error"}`, {
						error: res.error,
					});
				}
				return ok("Browser session closed.");
			}),
	};
}

// ─── small utils ─────────────────────────────────────────────────────

export function withScheme(url: string): string {
	if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) return url;
	return `https://${url}`;
}

function textOf(data: unknown): string {
	if (data == null) return "";
	if (typeof data === "string") return data;
	if (typeof data === "object") {
		const d = data as Record<string, unknown>;
		if (typeof d.text === "string") return d.text;
		if (typeof d.snapshot === "string") return d.snapshot;
	}
	return JSON.stringify(data);
}
