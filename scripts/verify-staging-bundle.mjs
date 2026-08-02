import { readFileSync } from "node:fs";

const bundlePath = "src-tauri/agent-sidecar/index.cjs";
const bundle = readFileSync(bundlePath, "utf8");
const config = {
	clientId: (process.env.ZOSMA_GOOGLE_CLIENT_ID || "").trim(),
	brokerUrl: (process.env.ZOSMA_OAUTH_BROKER_URL || "").trim(),
	authBaseUrl: (process.env.ZOSMA_AUTH_BASE_URL || "").trim(),
	routerBaseUrl: (process.env.ZOSMA_ROUTER_BASE_URL || "").trim(),
};
for (const [name, value] of Object.entries(config)) {
	if (!value) throw new Error(`${name} is required for staging bundle verification`);
}
const required = [
	`BAKED_CLIENT_ID = "${config.clientId}"`,
	`BAKED_BROKER_URL = "${config.brokerUrl}"`,
	`BAKED_AUTH_BASE_URL = "${config.authBaseUrl}"`,
	`BAKED_ROUTER_BASE_URL = "${config.routerBaseUrl}"`,
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
