import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	deleteSessionFile,
	listSessions,
	loadSessionMessages,
	renameSession,
	saveSessionFile,
	searchSessions,
	setSessionPinned,
} from "./session-store.js";

/** Write a raw JSONL session file (header + messages). */
function writeSession(
	dir: string,
	file: string,
	header: Record<string, unknown>,
	messages: Array<Record<string, unknown>> = [],
): void {
	const lines = [JSON.stringify({ type: "session", version: 1, ...header })];
	for (const m of messages) lines.push(JSON.stringify(m));
	writeFileSync(join(dir, file), `${lines.join("\n")}\n`, "utf-8");
}

describe("session-store", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "zosma-sessions-"));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	describe("listSessions — sorting", () => {
		it("returns [] for a missing directory", () => {
			expect(listSessions(join(dir, "nope"))).toEqual([]);
		});

		it("sorts pinned sessions first, then by most-recent activity", () => {
			writeSession(dir, "a.jsonl", { title: "A", createdAt: 100, pinned: false }, [
				{ role: "user", content: "hi", timestamp: 100 },
			]);
			writeSession(dir, "b.jsonl", { title: "B", createdAt: 200, pinned: false }, [
				{ role: "user", content: "yo", timestamp: 300 },
			]);
			writeSession(dir, "c.jsonl", { title: "C", createdAt: 150, pinned: true }, [
				{ role: "user", content: "pin", timestamp: 150 },
			]);

			const list = listSessions(dir);
			expect(list.map((s) => s.file)).toEqual(["c.jsonl", "b.jsonl", "a.jsonl"]);
			// Pinned flag surfaced.
			expect(list[0].pinned).toBe(true);
		});

		it("surfaces a real content preview (not a placeholder)", () => {
			writeSession(dir, "a.jsonl", { title: "A", createdAt: 100 }, [
				{ role: "user", content: "first question", timestamp: 100 },
				{ role: "assistant", content: "the detailed answer here", timestamp: 200 },
			]);
			const [s] = listSessions(dir);
			expect(s.preview).toBe("the detailed answer here");
		});

		it("treats legacy sessions (no pinned/titleLocked) as falsy", () => {
			writeSession(dir, "legacy.jsonl", { title: "Legacy", createdAt: 100 }, [
				{ role: "user", content: "x", timestamp: 100 },
			]);
			const [s] = listSessions(dir);
			expect(s.pinned).toBe(false);
			expect(s.titleLocked).toBe(false);
		});
	});

	describe("saveSessionFile — locked title no-overwrite", () => {
		it("does not overwrite a locked title with an auto-derived one", () => {
			writeSession(dir, "s.jsonl", { title: "Old", createdAt: 50 }, [
				{ role: "user", content: "hello", timestamp: 50 },
			]);
			// User renames → title locked.
			renameSession(dir, "s.jsonl", "My Custom Name");
			// A later auto-save passes a different (derived) title.
			saveSessionFile(dir, "s", "hello", [{ role: "user", content: "hello", timestamp: 50 }]);

			const [s] = listSessions(dir);
			expect(s.title).toBe("My Custom Name");
			expect(s.titleLocked).toBe(true);
		});

		it("uses the passed title when not locked", () => {
			saveSessionFile(dir, "s", "Auto Title", [{ role: "user", content: "x", timestamp: 1 }]);
			const [s] = listSessions(dir);
			expect(s.title).toBe("Auto Title");
		});

		it("preserves the pinned flag across re-saves", () => {
			saveSessionFile(dir, "s", "T", [{ role: "user", content: "x", timestamp: 1 }]);
			setSessionPinned(dir, "s.jsonl", true);
			saveSessionFile(dir, "s", "T2", [
				{ role: "user", content: "x", timestamp: 1 },
				{ role: "assistant", content: "y", timestamp: 2 },
			]);
			const [s] = listSessions(dir);
			expect(s.pinned).toBe(true);
		});

		it("preserves the original createdAt across re-saves", () => {
			writeSession(dir, "s.jsonl", { title: "T", createdAt: 12345 }, [
				{ role: "user", content: "x", timestamp: 12345 },
			]);
			saveSessionFile(dir, "s", "T", [{ role: "user", content: "x", timestamp: 12345 }]);
			const [s] = listSessions(dir);
			expect(s.createdAt).toBe(12345);
		});
	});

	describe("rename / pin — header patch preserves messages", () => {
		it("renames without corrupting message bodies", () => {
			writeSession(dir, "s.jsonl", { title: "Old", createdAt: 1 }, [
				{ role: "user", content: "message one", timestamp: 1 },
				{ role: "assistant", content: "message two", timestamp: 2 },
			]);
			expect(renameSession(dir, "s.jsonl", "Renamed")).toBe(true);
			const msgs = loadSessionMessages(dir, "s.jsonl") as Array<{ content: string }>;
			expect(msgs).toHaveLength(2);
			expect(msgs[0].content).toBe("message one");
			expect(msgs[1].content).toBe("message two");
		});

		it("rejects an empty rename", () => {
			writeSession(dir, "s.jsonl", { title: "Old", createdAt: 1 }, []);
			expect(renameSession(dir, "s.jsonl", "   ")).toBe(false);
		});

		it("toggles pinned in place", () => {
			writeSession(dir, "s.jsonl", { title: "T", createdAt: 1 }, [
				{ role: "user", content: "x", timestamp: 1 },
			]);
			expect(setSessionPinned(dir, "s.jsonl", true)).toBe(true);
			expect(listSessions(dir)[0].pinned).toBe(true);
			expect(setSessionPinned(dir, "s.jsonl", false)).toBe(true);
			expect(listSessions(dir)[0].pinned).toBe(false);
		});

		it("returns false patching a missing file", () => {
			expect(renameSession(dir, "missing.jsonl", "X")).toBe(false);
			expect(setSessionPinned(dir, "missing.jsonl", true)).toBe(false);
		});
	});

	describe("searchSessions — deep content match", () => {
		beforeEach(() => {
			writeSession(dir, "react.jsonl", { title: "React setup", createdAt: 100 }, [
				{ role: "user", content: "How do I configure vite?", timestamp: 100 },
				{ role: "assistant", content: "Use the vite config file with plugins.", timestamp: 200 },
			]);
			writeSession(dir, "rust.jsonl", { title: "Rust borrow checker", createdAt: 300 }, [
				{ role: "user", content: "Explain ownership and lifetimes.", timestamp: 300 },
			]);
		});

		it("matches real message content, not just the title", () => {
			const matches = searchSessions(dir, "ownership");
			expect(matches.map((m) => m.file)).toEqual(["rust.jsonl"]);
			expect(matches[0].snippet.toLowerCase()).toContain("ownership");
		});

		it("matches the title too", () => {
			const matches = searchSessions(dir, "borrow checker");
			expect(matches.map((m) => m.file)).toContain("rust.jsonl");
		});

		it("is case-insensitive and counts multiple hits", () => {
			const matches = searchSessions(dir, "VITE");
			expect(matches.map((m) => m.file)).toEqual(["react.jsonl"]);
			// "vite" appears in two messages.
			expect(matches[0].matchCount).toBeGreaterThanOrEqual(2);
		});

		it("returns [] for an empty query", () => {
			expect(searchSessions(dir, "   ")).toEqual([]);
		});

		it("orders results pinned-first then most-recent", () => {
			writeSession(dir, "pinned.jsonl", { title: "T", createdAt: 1, pinned: true }, [
				{ role: "user", content: "shared keyword vite here", timestamp: 1 },
			]);
			const matches = searchSessions(dir, "vite");
			expect(matches[0].file).toBe("pinned.jsonl");
		});
	});

	describe("deleteSessionFile", () => {
		it("deletes an existing file and reports false for a missing one", () => {
			writeSession(dir, "s.jsonl", { title: "T", createdAt: 1 }, []);
			expect(deleteSessionFile(dir, "s.jsonl")).toBe(true);
			expect(deleteSessionFile(dir, "s.jsonl")).toBe(false);
		});
	});
});
