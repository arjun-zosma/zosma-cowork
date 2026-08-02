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
import { createHash } from "node:crypto";
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

// Inject the brokered Google Workspace/Gmail config. These are PUBLIC values
// (the Web client_id and broker HTTPS URL) — NO secret is ever baked, because
// the secret lives only in the backend broker. Staging and production workflows
// pass explicit values so packaged apps never depend on shell env at runtime.
// Zosma Router login uses its own server-side Google configuration.
console.log("[prebuild] Injecting Zosma Google OAuth config (public)...");
const buildMode = process.env.ZOSMA_RELEASE === "1"
	? "production"
	: process.env.ZOSMA_STAGING === "1"
		? "staging"
		: null;

function requireHttpsBaseUrl(name, value, pathname, rejectStaging) {
	if (!value) throw new Error(`${name} is required for ${buildMode} builds`);
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`${name} must be a valid URL`);
	}
	if (url.protocol !== "https:" || url.pathname !== pathname || url.search || url.hash) {
		throw new Error(`${name} must be an HTTPS URL with path ${pathname}`);
	}
	if (rejectStaging && url.hostname.includes("staging")) {
		throw new Error(`${name} must not point to staging in a production build`);
	}
}

if (buildMode) {
	const clientId = (process.env.ZOSMA_GOOGLE_CLIENT_ID || "").trim();
	const broker = (process.env.ZOSMA_OAUTH_BROKER_URL || "").trim();
	const auth = (process.env.ZOSMA_AUTH_BASE_URL || "").trim();
	const router = (process.env.ZOSMA_ROUTER_BASE_URL || "").trim();
	if (buildMode === "production") {
		const approvedFingerprint = (process.env.ZOSMA_RELEASE_CONFIG_FINGERPRINT || "").trim();
		if (!approvedFingerprint) throw new Error("ZOSMA_RELEASE_CONFIG_FINGERPRINT secret is missing");
		const actualFingerprint = createHash("sha256")
			.update([clientId, broker, auth, router].join("\n"))
			.digest("hex");
		if (actualFingerprint !== approvedFingerprint) {
			throw new Error("production config does not match the approved release fingerprint");
		}
	}
	if (!/^\d+-[a-z0-9-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
		throw new Error("ZOSMA_GOOGLE_CLIENT_ID must be a valid Google OAuth client id");
	}
	const rejectStaging = buildMode === "production";
	requireHttpsBaseUrl(
		"ZOSMA_OAUTH_BROKER_URL",
		broker,
		"/",
		rejectStaging,
	);
	requireHttpsBaseUrl(
		"ZOSMA_AUTH_BASE_URL",
		auth,
		"/",
		rejectStaging,
	);
	requireHttpsBaseUrl(
		"ZOSMA_ROUTER_BASE_URL",
		router,
		"/v1",
		rejectStaging,
	);
	console.log(`[prebuild] ${buildMode} endpoint configuration validated from environment`);
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
		console.log(`[prebuild]   ${envName} unset — leaving build slot unresolved`);
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
