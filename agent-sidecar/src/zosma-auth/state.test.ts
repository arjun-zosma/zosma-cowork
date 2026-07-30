/**
 * Tests for the file-backed pending auth transaction store.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deletePending, loadPending, pendingFilePath, savePending, type PendingAuthTransaction } from "./state.js";

describe("pending transaction store", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "zosma-auth-test-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	function makeTx(expiresInMs = 600_000): PendingAuthTransaction {
		return {
			state: "test-state-123",
			codeVerifier: "test-verifier-456",
			deviceId: "cowork-abc",
			expiresAt: Date.now() + expiresInMs,
		};
	}

	it("save + load roundtrip returns same values", () => {
		const tx = makeTx();
		savePending(tx, dir);
		const loaded = loadPending(dir);
		expect(loaded).not.toBeNull();
		expect(loaded!.state).toBe(tx.state);
		expect(loaded!.codeVerifier).toBe(tx.codeVerifier);
		expect(loaded!.deviceId).toBe(tx.deviceId);
	});

	it("returns null when no file exists", () => {
		expect(loadPending(dir)).toBeNull();
	});

	it("deletes and returns null on expired transaction", () => {
		const tx = makeTx(-1_000); // already expired
		savePending(tx, dir);
		expect(loadPending(dir)).toBeNull();

		// Verify file was cleaned up
		expect(loadPending(dir)).toBeNull();
	});

	it("returns null on corrupt JSON", () => {
		const path = pendingFilePath(dir);
		require("node:fs").writeFileSync(path, "not valid json{{{");
		expect(loadPending(dir)).toBeNull();
	});

	it("returns null on missing required fields", () => {
		const path = pendingFilePath(dir);
		require("node:fs").writeFileSync(path, JSON.stringify({ state: "only-state" }));
		expect(loadPending(dir)).toBeNull();
	});

	it("deletePending removes file", () => {
		savePending(makeTx(), dir);
		expect(loadPending(dir)).not.toBeNull();
		deletePending(dir);
		expect(loadPending(dir)).toBeNull();
	});

	it("deletePending is no-op when file missing", () => {
		// Should not throw
		deletePending(dir);
	});

	it("overwrites existing pending transaction on save", () => {
		savePending({ ...makeTx(), state: "first" }, dir);
		expect(loadPending(dir)!.state).toBe("first");

		savePending({ ...makeTx(), state: "second" }, dir);
		expect(loadPending(dir)!.state).toBe("second");
	});

	it("persists JSON with indentation", () => {
		savePending(makeTx(), dir);
		const raw = readFileSync(pendingFilePath(dir), "utf-8");
		expect(raw).toContain("\n"); // indented JSON has newlines
		expect(() => JSON.parse(raw)).not.toThrow();
	});

	it("rejects non-string field types", () => {
		const path = pendingFilePath(dir);
		require("node:fs").writeFileSync(
			path,
			JSON.stringify({
				state: 123, // should be string
				codeVerifier: "verifier",
				deviceId: "dev",
				expiresAt: Date.now() + 600_000,
			}),
		);
		expect(loadPending(dir)).toBeNull();
	});

	it("rejects expiresAt that is NaN", () => {
		const path = pendingFilePath(dir);
		require("node:fs").writeFileSync(
			path,
			JSON.stringify({
				state: "s",
				codeVerifier: "v",
				deviceId: "d",
				expiresAt: NaN,
			}),
		);
		// NaN is typeof "number" but JSON.stringify serializes it as null
		// So this becomes null after JSON roundtrip, which fails the typeof check.
		expect(loadPending(dir)).toBeNull();
	});

	it("rejects negative expiresAt", () => {
		const path = pendingFilePath(dir);
		require("node:fs").writeFileSync(
			path,
			JSON.stringify({
				state: "s",
				codeVerifier: "v",
				deviceId: "d",
				expiresAt: -1,
			}),
		);
		// -1 is a number, passes typeof check, but Date.now() > -1 is true → expired
		expect(loadPending(dir)).toBeNull();
	});

	it("rejects null deviceId", () => {
		const path = pendingFilePath(dir);
		require("node:fs").writeFileSync(
			path,
			JSON.stringify({
				state: "s",
				codeVerifier: "v",
				deviceId: null,
				expiresAt: Date.now() + 600_000,
			}),
		);
		expect(loadPending(dir)).toBeNull();
	});

	it("sets 0600 permissions on save", () => {
		const tx = makeTx();
		savePending(tx, dir);
		const path = pendingFilePath(dir);
		const stat = require("node:fs").statSync(path);
		// On Unix, 0o600 means owner read+write only
		// stat.mode includes file type bits; mask to get permission bits
		const perms = stat.mode & 0o777;
		expect(perms).toBe(0o600);
	});
});