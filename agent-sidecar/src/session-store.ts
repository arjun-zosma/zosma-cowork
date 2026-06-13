/**
 * session-store — persistence for Zosma Cowork chat sessions.
 *
 * Each session is a JSONL file: the FIRST line is a `{ type: "session", … }`
 * header, every subsequent line is one chat message. This module owns the
 * header schema and all the read/mutate/sort logic so it can be unit-tested in
 * isolation (the sidecar's `index.ts` is a thin command dispatcher over these).
 *
 * Header schema (all fields after `messageCount` are OPTIONAL and default
 * falsy, so legacy sessions written before this module keep working):
 *
 *   { type:"session", version, title, createdAt, model?, provider?, cwd?,
 *     messageCount, titleLocked?, pinned? }
 *
 * Sticky user fields:
 *   - `titleLocked` — the user renamed this chat; auto-derived titles must NOT
 *     overwrite it on the next save.
 *   - `pinned` — float this chat to the top of the sidebar list.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

export interface SessionListEntry {
	file: string;
	title: string;
	model?: string;
	provider?: string;
	cwd?: string;
	messageCount: number;
	createdAt: number;
	lastActivity: number;
	pinned: boolean;
	titleLocked: boolean;
	/** One-line preview of the latest human-readable message. */
	preview: string;
}

export interface SessionSearchMatch {
	file: string;
	/** Contextual snippet around the first content match. */
	snippet: string;
	/** Number of messages (plus title) that matched. */
	matchCount: number;
}

function ensureDir(dir: string): void {
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * List all session files with their header metadata, pinned-first then
 * most-recent. Unreadable files are skipped.
 */
export function listSessions(sessionsDir: string): SessionListEntry[] {
	if (!existsSync(sessionsDir)) return [];

	const files = readdirSync(sessionsDir)
		.filter((f) => f.endsWith(".jsonl"))
		.sort()
		.reverse();

	const sessions: SessionListEntry[] = [];

	for (const file of files) {
		try {
			const content = readFileSync(join(sessionsDir, file), "utf-8");
			const lines = content.trim().split("\n");
			if (lines.length === 0) continue;

			const header = JSON.parse(lines[0]);
			if (header.type !== "session") continue;

			const messageCount = lines.slice(1).filter((l) => l.trim()).length;

			// Walk from the end for the last activity time and a content preview.
			let lastActivity = header.createdAt || 0;
			let preview = "";
			for (let i = lines.length - 1; i >= 1; i--) {
				try {
					const msg = JSON.parse(lines[i]);
					if (lastActivity === (header.createdAt || 0) && msg.timestamp) {
						lastActivity = msg.timestamp;
					}
					if (!preview && typeof msg.content === "string" && msg.content.trim()) {
						preview = msg.content.replace(/\s+/g, " ").trim().slice(0, 120);
					}
					if (preview) break;
				} catch {
					// ignore malformed line
				}
			}

			sessions.push({
				file,
				title: header.title || file.replace(".jsonl", ""),
				model: header.model,
				provider: header.provider,
				cwd: typeof header.cwd === "string" ? header.cwd : undefined,
				messageCount,
				createdAt: header.createdAt || 0,
				lastActivity,
				pinned: header.pinned === true,
				titleLocked: header.titleLocked === true,
				preview,
			});
		} catch {
			// skip files we can't read/parse
		}
	}

	sessions.sort((a, b) => {
		if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
		return b.lastActivity - a.lastActivity;
	});
	return sessions;
}

/**
 * Save messages to a session JSONL file, preserving sticky header fields. A
 * locked (manually-renamed) title and the `pinned` flag survive re-saves; the
 * original `createdAt` is kept too.
 */
export function saveSessionFile(
	sessionsDir: string,
	sessionId: string,
	title: string,
	messages: unknown[],
	model?: string,
	provider?: string,
	cwd?: string,
): void {
	ensureDir(sessionsDir);

	const cleanId = sessionId.replace(/\.jsonl$/i, "");
	const filePath = join(sessionsDir, `${cleanId}.jsonl`);

	let prior: Record<string, unknown> = {};
	if (existsSync(filePath)) {
		try {
			const firstLine = readFileSync(filePath, "utf-8").split("\n", 1)[0];
			const parsed = JSON.parse(firstLine);
			if (parsed && parsed.type === "session") prior = parsed;
		} catch {
			// treat as fresh
		}
	}
	const titleLocked = prior.titleLocked === true;
	const pinned = prior.pinned === true;

	const header = {
		type: "session",
		version: 1,
		title: titleLocked && typeof prior.title === "string" ? prior.title : title,
		createdAt: typeof prior.createdAt === "number" ? prior.createdAt : Date.now(),
		model,
		provider,
		cwd,
		messageCount: messages.length,
		titleLocked,
		pinned,
	};

	const lines = [JSON.stringify(header)];
	for (const msg of messages) lines.push(JSON.stringify(msg));
	writeFileSync(filePath, `${lines.join("\n")}\n`, "utf-8");
}

/**
 * Load the message bodies (everything after the header) from a session file.
 * Throws if the file is missing.
 */
export function loadSessionMessages(sessionsDir: string, sessionFile: string): unknown[] {
	const filePath = join(sessionsDir, sessionFile);
	if (!existsSync(filePath)) {
		throw new Error(`Session not found: ${sessionFile}`);
	}
	const lines = readFileSync(filePath, "utf-8").trim().split("\n");
	const messages: unknown[] = [];
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line) continue;
		try {
			messages.push(JSON.parse(line));
		} catch {
			// skip invalid line
		}
	}
	return messages;
}

/** Read and return a session's parsed header, or null if unreadable. */
export function readSessionHeader(
	sessionsDir: string,
	sessionFile: string,
): Record<string, unknown> | null {
	const filePath = join(sessionsDir, sessionFile);
	if (!existsSync(filePath)) return null;
	try {
		const firstLine = readFileSync(filePath, "utf-8").split("\n", 1)[0];
		const parsed = JSON.parse(firstLine);
		return parsed && parsed.type === "session" ? parsed : null;
	} catch {
		return null;
	}
}

/** Delete a session file. Returns false if it did not exist. */
export function deleteSessionFile(sessionsDir: string, sessionFile: string): boolean {
	const filePath = join(sessionsDir, sessionFile);
	if (!existsSync(filePath)) return false;
	unlinkSync(filePath);
	return true;
}

/**
 * Patch fields on a session's JSONL header in place. Rewrites ONLY the first
 * line; the message bodies that follow are preserved byte-for-byte (including
 * their original line endings). Returns false if the file or header is bad.
 */
export function patchSessionHeader(
	sessionsDir: string,
	sessionFile: string,
	patch: Record<string, unknown>,
): boolean {
	const filePath = join(sessionsDir, sessionFile);
	if (!existsSync(filePath)) return false;
	const content = readFileSync(filePath, "utf-8");
	const nl = content.indexOf("\n");
	const headerLine = nl === -1 ? content : content.slice(0, nl);
	const rest = nl === -1 ? "" : content.slice(nl); // keeps the leading \n
	let header: Record<string, unknown>;
	try {
		header = JSON.parse(headerLine);
	} catch {
		return false;
	}
	if (header.type !== "session") return false;
	const next = { ...header, ...patch };
	writeFileSync(filePath, `${JSON.stringify(next)}${rest}`, "utf-8");
	return true;
}

/**
 * Rename a session: set a user-chosen title and lock it so future auto-derived
 * saves don't overwrite it. Empty titles are rejected.
 */
export function renameSession(sessionsDir: string, sessionFile: string, title: string): boolean {
	const clean = title.trim().slice(0, 200);
	if (!clean) return false;
	return patchSessionHeader(sessionsDir, sessionFile, { title: clean, titleLocked: true });
}

/** Pin or unpin a session (floats it to the top of the sidebar list). */
export function setSessionPinned(
	sessionsDir: string,
	sessionFile: string,
	pinned: boolean,
): boolean {
	return patchSessionHeader(sessionsDir, sessionFile, { pinned: pinned === true });
}

/**
 * Deep content search across all session bodies. Matches `query`
 * (case-insensitive) against real message text and the title, returning each
 * matching file with a contextual snippet and match count, pinned-first then
 * most-recent.
 */
export function searchSessions(sessionsDir: string, query: string): SessionSearchMatch[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	if (!existsSync(sessionsDir)) return [];

	const results: Array<SessionSearchMatch & { pinned: boolean; lastActivity: number }> = [];

	for (const file of readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"))) {
		try {
			const lines = readFileSync(join(sessionsDir, file), "utf-8").trim().split("\n");
			if (lines.length === 0) continue;
			let header: Record<string, unknown>;
			try {
				header = JSON.parse(lines[0]);
			} catch {
				continue;
			}
			if (header.type !== "session") continue;

			let matchCount = 0;
			let snippet = "";
			let lastActivity = (header.createdAt as number) || 0;
			if (typeof header.title === "string" && header.title.toLowerCase().includes(q)) {
				matchCount++;
			}
			for (let i = 1; i < lines.length; i++) {
				let msg: Record<string, unknown>;
				try {
					msg = JSON.parse(lines[i]);
				} catch {
					continue;
				}
				if (typeof msg.timestamp === "number") lastActivity = msg.timestamp;
				const text = typeof msg.content === "string" ? msg.content : "";
				const idx = text.toLowerCase().indexOf(q);
				if (idx !== -1) {
					matchCount++;
					if (!snippet) {
						const start = Math.max(0, idx - 40);
						const end = Math.min(text.length, idx + q.length + 40);
						snippet = `${start > 0 ? "…" : ""}${text
							.slice(start, end)
							.replace(/\s+/g, " ")
							.trim()}${end < text.length ? "…" : ""}`;
					}
				}
			}
			if (matchCount > 0) {
				results.push({
					file,
					snippet: snippet || (typeof header.title === "string" ? header.title : ""),
					matchCount,
					pinned: header.pinned === true,
					lastActivity,
				});
			}
		} catch {
			// skip unreadable file
		}
	}

	results.sort((a, b) => {
		if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
		return b.lastActivity - a.lastActivity;
	});
	return results.map(({ file, snippet, matchCount }) => ({ file, snippet, matchCount }));
}
