/**
 * Phase 0 smoke test for the agent-browser executor.
 *
 * Drives a real navigate -> snapshot -> extract -> close cycle against
 * example.com to prove the CLI integration end-to-end. Not a unit test
 * (it spawns the real daemon + browser); run manually:
 *
 *   npx tsx src/browser/smoke.ts
 */

import { getAgentBrowserExecutor } from "./agent-browser-executor.js";

function line(label: string, ok: boolean, extra = ""): void {
	console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

async function main(): Promise<void> {
	const exec = getAgentBrowserExecutor();
	let failures = 0;

	const open = exec.open("https://example.com");
	const openOk = open.success && !!open.data;
	line("navigate example.com", openOk, open.data?.title ?? open.error ?? "");
	if (!openOk) failures++;

	const snap = exec.snapshot(true, false);
	const snapOk = snap.success && !!snap.data?.snapshot;
	const refCount = Object.keys(snap.data?.refs ?? {}).length;
	line("snapshot -i", snapOk, `${refCount} refs`);
	if (!snapOk) failures++;

	const extract = exec.snapshot(false, false);
	const extractOk = extract.success && !!extract.data?.snapshot;
	line(
		"extract full page",
		extractOk,
		`${extract.data?.snapshot?.length ?? 0} chars`,
	);
	if (!extractOk) failures++;

	const close = exec.close();
	line("close", close.success);
	if (!close.success) failures++;

	console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
	process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
	console.error("smoke crashed:", err);
	process.exit(1);
});
