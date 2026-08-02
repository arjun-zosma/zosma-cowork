import { createHash } from "node:crypto";

const config = {
	clientId: (process.env.ZOSMA_GOOGLE_CLIENT_ID || "").trim(),
	brokerUrl: (process.env.ZOSMA_OAUTH_BROKER_URL || "").trim(),
	authBaseUrl: (process.env.ZOSMA_AUTH_BASE_URL || "").trim(),
	routerBaseUrl: (process.env.ZOSMA_ROUTER_BASE_URL || "").trim(),
};

if (!config.clientId) throw new Error("ZOSMA_GOOGLE_CLIENT_ID repository variable is missing");
const approvedFingerprint = (process.env.ZOSMA_RELEASE_CONFIG_FINGERPRINT || "").trim();
if (!approvedFingerprint) throw new Error("ZOSMA_RELEASE_CONFIG_FINGERPRINT secret is missing");
if (!/^\d+-[a-z0-9-]+\.apps\.googleusercontent\.com$/.test(config.clientId)) {
	throw new Error("ZOSMA_GOOGLE_CLIENT_ID is not a Google OAuth client id");
}

function parseProductionUrl(name, value, pathname) {
	if (!value) throw new Error(`${name} repository variable is missing`);
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`${name} must be a valid URL`);
	}
	if (url.protocol !== "https:" || url.pathname !== pathname || url.search || url.hash) {
		throw new Error(`${name} must be an HTTPS URL with path ${pathname}`);
	}
	if (url.hostname.includes("staging")) {
		throw new Error(`${name} must not point to staging in a production release`);
	}
	return url;
}

const brokerUrl = parseProductionUrl("ZOSMA_OAUTH_BROKER_URL", config.brokerUrl, "/");
parseProductionUrl("ZOSMA_AUTH_BASE_URL", config.authBaseUrl, "/");
parseProductionUrl("ZOSMA_ROUTER_BASE_URL", config.routerBaseUrl, "/v1");
const actualFingerprint = createHash("sha256")
	.update([config.clientId, config.brokerUrl, config.authBaseUrl, config.routerBaseUrl].join("\n"))
	.digest("hex");
if (actualFingerprint !== approvedFingerprint) {
	throw new Error("production config does not match the approved release fingerprint");
}

const health = await fetch(new URL("/health", brokerUrl), {
	signal: AbortSignal.timeout(15_000),
});
if (!health.ok) throw new Error(`production OAuth broker health returned HTTP ${health.status}`);
const body = await health.json();
if (body?.ok !== true || body?.service !== "zosma-oauth-broker") {
	throw new Error("production OAuth broker health response is invalid");
}

console.log(`Production OAuth config valid: broker=${brokerUrl.hostname}, client_id=present`);
