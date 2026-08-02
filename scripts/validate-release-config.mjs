const productionBrokerHost = "broker-prod-uoux53xara-uc.a.run.app";
// Public identifier for the production Web OAuth client. The secret is never
// stored here; it remains in the broker's Secret Manager.
const productionClientId =
	"830231223031-3ltm086u8ngc67ah5r1bk706g285ahkl.apps.googleusercontent.com";
const clientId = (process.env.ZOSMA_GOOGLE_CLIENT_ID || "").trim();
const brokerUrl = (process.env.ZOSMA_OAUTH_BROKER_URL || "").trim();

if (!clientId) throw new Error("ZOSMA_GOOGLE_CLIENT_ID repository variable is missing");
if (!/^\d+-[a-z0-9-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
	throw new Error("ZOSMA_GOOGLE_CLIENT_ID is not a Google OAuth client id");
}
if (clientId !== productionClientId) {
	throw new Error("ZOSMA_GOOGLE_CLIENT_ID is not the production Web OAuth client");
}

let url;
try {
	url = new URL(brokerUrl);
} catch {
	throw new Error("ZOSMA_OAUTH_BROKER_URL must be a valid URL");
}
if (url.protocol !== "https:" || url.hostname !== productionBrokerHost || url.pathname !== "/") {
	throw new Error(`release broker must be https://${productionBrokerHost}`);
}

const health = await fetch(new URL("/health", url), {
	signal: AbortSignal.timeout(15_000),
});
if (!health.ok) throw new Error(`production OAuth broker health returned HTTP ${health.status}`);
const body = await health.json();
if (body?.ok !== true || body?.service !== "zosma-oauth-broker") {
	throw new Error("production OAuth broker health response is invalid");
}

console.log(`Production OAuth config valid: broker=${url.hostname}, client_id=present`);
