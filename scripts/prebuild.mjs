// Cross-platform prebuild script for Tauri beforeBuildCommand
// Bundles the agent-sidecar into a single self-contained CJS file
// with all dependencies inlined, so no node_modules/ needed at runtime.
//
// The vendored pi-anthropic-messages bridge is managed by
// `agent-sidecar/scripts/fetch-vendor.mjs`, which the sidecar's
// `postinstall` hook runs automatically before tsc/esbuild see the
// source. We don't duplicate that logic here — the `pnpm install` below
// triggers it.

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sidecarDir = join(root, "agent-sidecar");

console.log("[prebuild] Building agent-sidecar bundle...");
execSync("pnpm install --frozen-lockfile && pnpm run bundle", {
	cwd: sidecarDir,
	shell: true,
	stdio: "inherit",
});

// Patch import_meta.url for CJS compatibility.
// esbuild shims `import.meta.url` as `import_meta<number> = {}` and reads `.url`
// at runtime. In CJS the object is empty so `.url` is undefined -> fileURLToPath
// throws at module load. Two shapes occur:
//   (a) top-level: `var import_meta10 = {};`            (our own source)
//   (b) inside __esm() wrappers, split: declaration `var ..., import_meta, ...;`
//       then assignment `import_meta = {};` with NO `var` (pi-SDK modules).
// Matching the assignment (no `var ` prefix) catches both.
console.log("[prebuild] Patching import_meta.url...");
const bundlePath = join(sidecarDir, "dist", "bundle.cjs");
let code = readFileSync(bundlePath, "utf-8");
const importMetaRe = /(import_meta\d*) = \{\};/g;
const patchedCount = (code.match(importMetaRe) || []).length;
code = code.replace(
	importMetaRe,
	'$1 = { url: require("url").pathToFileURL(__filename).href };',
);
console.log(`[prebuild]   patched ${patchedCount} import_meta.url shims`);
writeFileSync(bundlePath, code, "utf-8");

// Inline pi-coding-agent's package.json into the bundle to avoid
// needing the file at runtime (the bundled code reads its own
// package.json for name, version, piConfig.configDir, etc.).
console.log("[prebuild] Inlining pi-coding-agent package.json...");
const piPkgPath = join(sidecarDir, "node_modules", "@earendil-works", "pi-coding-agent", "package.json");
const piPkg = JSON.parse(readFileSync(piPkgPath, "utf-8"));
const inlinedPkg = JSON.stringify({ name: piPkg.name, version: piPkg.version, piConfig: piPkg.piConfig });
code = code.replace(
	'var pkg = JSON.parse((0, import_fs.readFileSync)(getPackageJsonPath(), "utf-8"));',
	`var pkg = ${inlinedPkg};`,
);
writeFileSync(bundlePath, code, "utf-8");

// Inject the Antigravity OAuth client secret. It is NOT committed to source
// (GitHub secret-scanning would block it, and it shouldn't live in the repo) —
// constants.ts ships a placeholder. Sourced here from $ANTIGRAVITY_CLIENT_SECRET
// or the gitignored agent-sidecar/antigravity-client-secret file, and baked into
// the bundle. If unavailable, the placeholder stays and Gemini (Google) sign-in
// fails with a clear message instead of breaking the build.
console.log("[prebuild] Injecting Antigravity client secret...");
const secretFile = join(sidecarDir, "antigravity-client-secret");
const antigravitySecret =
	(process.env.ANTIGRAVITY_CLIENT_SECRET || "").trim() ||
	(existsSync(secretFile) ? readFileSync(secretFile, "utf-8").trim() : "");
if (antigravitySecret) {
	if (process.env.ZOSMA_RELEASE === "1") {
		throw new Error("production release must not embed a Google client secret");
	}
	code = code.split("__ANTIGRAVITY_CLIENT_SECRET__").join(antigravitySecret);
	writeFileSync(bundlePath, code, "utf-8");
	console.log("[prebuild]   client secret injected");
} else {
	console.warn("[prebuild]   no ANTIGRAVITY_CLIENT_SECRET — Gemini (Google) sign-in disabled");
}

// Inject the Zosma Google OAuth config. These are PUBLIC values (the Web
// client_id and the broker's HTTPS URL) — NO secret is ever baked, because the
// secret lives only in the backend broker. Staging and production workflows
// pass explicit values so packaged apps never depend on shell env at runtime.
console.log("[prebuild] Injecting Zosma Google OAuth config (public)...");
const buildConfig = process.env.ZOSMA_RELEASE === "1"
	? {
			name: "production",
			clientId: "830231223031-3ltm086u8ngc67ah5r1bk706g285ahkl.apps.googleusercontent.com",
			broker: "https://broker-prod-uoux53xara-uc.a.run.app",
			auth: "https://auth.zosma.ai",
			router: "https://router.zosma.ai/v1",
		}
	: process.env.ZOSMA_STAGING === "1"
		? {
				name: "staging",
				clientId: "830231223031-nuqrip1jo53pa55ithrrbu4jk0nu60s7.apps.googleusercontent.com",
				broker: "https://broker-uoux53xara-uc.a.run.app",
				auth: "https://auth.staging.zosma.ai",
				router: "https://router.staging.zosma.ai/v1",
			}
		: null;
if (buildConfig) {
		const actual = {
			clientId: (process.env.ZOSMA_GOOGLE_CLIENT_ID || "").trim(),
			broker: (process.env.ZOSMA_OAUTH_BROKER_URL || "").trim(),
			auth: (process.env.ZOSMA_AUTH_BASE_URL || "").trim(),
			router: (process.env.ZOSMA_ROUTER_BASE_URL || "").trim(),
		};
		for (const key of ["clientId", "broker", "auth", "router"]) {
			if (actual[key] !== buildConfig[key]) {
				throw new Error(`${buildConfig.name} build has incorrect ${key} configuration`);
			}
		}
		console.log(`[prebuild] ${buildConfig.name} endpoint configuration validated`);
	}
for (const [token, envName] of [
	["__ZOSMA_GOOGLE_CLIENT_ID__", "ZOSMA_GOOGLE_CLIENT_ID"],
	["__ZOSMA_OAUTH_BROKER_URL__", "ZOSMA_OAUTH_BROKER_URL"],
	["__ZOSMA_AUTH_BASE_URL__", "ZOSMA_AUTH_BASE_URL"],
	["__ZOSMA_ROUTER_BASE_URL__", "ZOSMA_ROUTER_BASE_URL"],
]) {
	const val = (process.env[envName] || "").trim();
	if (val) {
		code = code.split(token).join(val);
		console.log(`[prebuild]   baked ${envName}`);
	} else {
		console.log(`[prebuild]   ${envName} unset — using committed staging default`);
	}
}

// No Zosma Google client secret is accepted here. Desktop bundles are
// extractable; the Web client secret stays in the OAuth broker's Secret Manager.
writeFileSync(bundlePath, code, "utf-8");

// Copy bundled file into src-tauri/ for Tauri resource bundling
const targetDir = join(root, "src-tauri", "agent-sidecar");
mkdirSync(targetDir, { recursive: true });
// Clean stale files from previous builds
console.log("[prebuild] Cleaning stale artifacts...");
for (const f of ["index.cjs", "index.d.ts", "index.js", "index.js.map", "index.d.ts.map"]) {
	try { rmSync(join(targetDir, f)); } catch { /* ignore */ }
}

console.log("[prebuild] Copying bundle...");
cpSync(bundlePath, join(targetDir, "index.cjs"));

console.log(`[prebuild] Done (${(code.length / 1024 / 1024).toFixed(1)} MB)`);
