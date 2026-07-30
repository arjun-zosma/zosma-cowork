/**
 * Zosma Router Auth — Pending Transaction Store.
 *
 * File-backed store for PKCE state + code_verifier. Survives app restart,
 * expires after 10 minutes, atomic write via rename, 0600 permissions.
 *
 * Path: `~/.pi/agent/zosma-auth-pending.json`
 */

import { chmodSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PENDING_FILE = "zosma-auth-pending.json";

export interface PendingAuthTransaction {
	state: string;
	codeVerifier: string;
	deviceId: string;
	expiresAt: number; // epoch ms
}

/**
 * Resolve the path to the pending transaction file.
 */
export function pendingFilePath(piDir: string): string {
	return join(piDir, PENDING_FILE);
}

/**
 * Atomically write a pending transaction to disk.
 * Uses temp file + rename for crash safety. Sets 0600 permissions.
 */
export function savePending(tx: PendingAuthTransaction, piDir: string): void {
	const dest = pendingFilePath(piDir);
	const tmp = dest + ".tmp";
	writeFileSync(tmp, JSON.stringify(tx, null, 2), { mode: 0o600 });
	chmodSync(tmp, 0o600);
	renameSync(tmp, dest);
}

/**
 * Load and validate the pending transaction.
 * Returns null if missing or expired (deletes expired file).
 * Returns null on corrupt JSON (leaves file for debugging).
 */
export function loadPending(piDir: string): PendingAuthTransaction | null {
	const path = pendingFilePath(piDir);
	if (!existsSync(path)) return null;

	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		// Corrupt JSON — leave file, caller will see no pending tx.
		return null;
	}

	if (!raw || typeof raw !== "object") return null;
	const obj = raw as Record<string, unknown>;

	// Validate required fields
	if (
		typeof obj.state !== "string" ||
		typeof obj.codeVerifier !== "string" ||
		typeof obj.deviceId !== "string" ||
		typeof obj.expiresAt !== "number"
	) {
		return null;
	}

	// Check expiry
	if (Date.now() > obj.expiresAt) {
		removePendingFile(path);
		return null;
	}

	return {
		state: obj.state,
		codeVerifier: obj.codeVerifier,
		deviceId: obj.deviceId,
		expiresAt: obj.expiresAt,
	};
}

/**
 * Remove the pending transaction file. No-op if missing.
 */
export function deletePending(piDir: string): void {
	removePendingFile(pendingFilePath(piDir));
}

function removePendingFile(path: string): void {
	try {
		if (existsSync(path)) unlinkSync(path);
	} catch {
		// Best-effort cleanup — don't fail the flow if we can't remove it.
	}
}