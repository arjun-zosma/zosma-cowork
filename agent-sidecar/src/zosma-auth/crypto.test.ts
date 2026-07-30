/**
 * Tests for PKCE crypto helpers (RFC 7636).
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateCodeVerifier, generateState, sha256Base64url } from "./crypto.js";

describe("generateState", () => {
	it("returns 64 hex characters (256 bits)", () => {
		const state = generateState();
		expect(state).toMatch(/^[0-9a-f]{64}$/);
	});

	it("generates unique values per call", () => {
		const a = generateState();
		const b = generateState();
		expect(a).not.toBe(b);
	});
});

describe("generateCodeVerifier", () => {
	it("returns base64url string of expected length", () => {
		// 32 random bytes → 43 base64url chars (no padding)
		const verifier = generateCodeVerifier();
		expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(verifier.length).toBe(43);
	});

	it("generates unique values per call", () => {
		const a = generateCodeVerifier();
		const b = generateCodeVerifier();
		expect(a).not.toBe(b);
	});
});

describe("sha256Base64url", () => {
	it("produces deterministic output for same input", () => {
		const input = "test-verifier-123";
		expect(sha256Base64url(input)).toBe(sha256Base64url(input));
	});

	it("matches manual SHA-256 + base64url", () => {
		const input = "dp_sp-mIm-PhgXNvabFKnz9fKPXC8HVCYJVm74Thy84";
		const challenge = sha256Base64url(input);
		const expected = createHash("sha256").update(input).digest().toString("base64url");
		expect(challenge).toBe(expected);
	});

	it("returns base64url string (no padding, no + or /)", () => {
		const verifier = generateCodeVerifier();
		const challenge = sha256Base64url(verifier);
		expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(challenge).not.toContain("=");
		expect(challenge).not.toContain("+");
		expect(challenge).not.toContain("/");
	});
});