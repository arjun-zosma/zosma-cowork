import { readFileSync } from "node:fs";

const bundlePath = "src-tauri/agent-sidecar/index.cjs";
const bundle = readFileSync(bundlePath, "utf8");
const required = [
	'BAKED_CLIENT_ID = "830231223031-nuqrip1jo53pa55ithrrbu4jk0nu60s7.apps.googleusercontent.com"',
	'BAKED_BROKER_URL = "https://broker-uoux53xara-uc.a.run.app"',
	'BAKED_AUTH_BASE_URL = "https://auth.staging.zosma.ai"',
	'BAKED_ROUTER_BASE_URL = "https://router.staging.zosma.ai/v1"',
];
const missing = required.filter((value) => !bundle.includes(value));
if (missing.length > 0) {
	throw new Error(`staging bundle endpoint validation failed: ${missing.join(", ")}`);
}

for (const slot of [
	"__ZOSMA_GOOGLE_CLIENT_ID__",
	"__ZOSMA_OAUTH_BROKER_URL__",
	"__ZOSMA_AUTH_BASE_URL__",
	"__ZOSMA_ROUTER_BASE_URL__",
]) {
	if (bundle.includes(slot)) throw new Error(`unresolved staging bundle slot: ${slot}`);
}

console.log("Staging bundle endpoints validated: broker, auth, and router are staging.");
