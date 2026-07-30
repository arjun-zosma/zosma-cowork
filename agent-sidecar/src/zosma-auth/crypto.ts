/**
 * Zosma Router Auth — PKCE (RFC 7636) helpers.
 *
 * Pure crypto utilities using Node built-in `crypto` module. No external deps.
 */

import { createHash, randomBytes } from "node:crypto";

/**
 * Generate a high-entropy random state parameter (64 hex chars = 256 bits).
 */
export function generateState(): string {
	return randomBytes(32).toString("hex");
}

/**
 * Generate a PKCE code verifier (32 random bytes, base64url-encoded).
 */
export function generateCodeVerifier(): string {
	return base64url(randomBytes(32));
}

/**
 * Derive S256 code challenge from a code verifier.
 */
export function sha256Base64url(input: string): string {
	return base64url(createHash("sha256").update(input).digest());
}

// ── internal ───────────────────────────────────────────────────────────────

/** Buffer → base64url (no padding, `-` and `_` instead of `+` and `/`). */
function base64url(buf: Buffer): string {
	return buf.toString("base64url");
}