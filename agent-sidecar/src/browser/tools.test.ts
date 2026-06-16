/**
 * Unit tests for the browser tool set (Phase 0).
 *
 * Deterministic only — no browser is spawned here. End-to-end coverage lives in
 * src/browser/smoke.ts (manual: `npx tsx src/browser/smoke.ts`).
 */

import { describe, expect, it } from "vitest";
import { normalizeRef } from "./agent-browser-executor.js";
import {
	createClickTool,
	createCloseTool,
	createExtractTool,
	createNavigateTool,
	createSnapshotTool,
	createTypeTool,
	withScheme,
} from "./tools.js";

describe("withScheme", () => {
	it("adds https:// when no scheme present", () => {
		expect(withScheme("example.com")).toBe("https://example.com");
		expect(withScheme("sub.example.com/path")).toBe(
			"https://sub.example.com/path",
		);
	});

	it("preserves an existing scheme", () => {
		expect(withScheme("http://example.com")).toBe("http://example.com");
		expect(withScheme("https://example.com")).toBe("https://example.com");
		expect(withScheme("file:///tmp/x.html")).toBe("file:///tmp/x.html");
	});
});

describe("normalizeRef", () => {
	it("prefixes bare ref ids with @", () => {
		expect(normalizeRef("e2")).toBe("@e2");
		expect(normalizeRef(" e10 ")).toBe("@e10");
	});

	it("leaves @-prefixed refs and selectors untouched", () => {
		expect(normalizeRef("@e2")).toBe("@e2");
		expect(normalizeRef("#submit")).toBe("#submit");
		expect(normalizeRef(".btn.primary")).toBe(".btn.primary");
	});
});

describe("tool registration shape", () => {
	const tools = [
		createNavigateTool(),
		createSnapshotTool(),
		createExtractTool(),
		createClickTool(),
		createTypeTool(),
		createCloseTool(),
	];

	it("exposes the six Phase 0 browser tools with expected names", () => {
		expect(tools.map((t) => t.name).sort()).toEqual(
			[
				"browser_click",
				"browser_close",
				"browser_extract",
				"browser_navigate",
				"browser_snapshot",
				"browser_type",
			].sort(),
		);
	});

	it("every tool has a label, description, and parameter schema", () => {
		for (const t of tools) {
			expect(t.label).toBeTruthy();
			expect(t.description.length).toBeGreaterThan(0);
			expect(t.parameters).toBeDefined();
			expect(typeof t.execute).toBe("function");
		}
	});
});
