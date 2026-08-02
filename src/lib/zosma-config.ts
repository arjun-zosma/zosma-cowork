function isLoopbackHost(hostname: string): boolean {
	return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function normalizeBaseUrl(name: string, value: string, pathname: string): string {
	if (!value.trim()) throw new Error(`${name} is required`);
	const normalized = value.trim().replace(/\/+$/, "");
	let url: URL;
	try {
		url = new URL(normalized);
	} catch {
		throw new Error(`${name} must be a valid URL`);
	}
	const local = url.protocol === "http:" && isLoopbackHost(url.hostname);
	if (url.protocol !== "https:" && !local) {
		throw new Error(`${name} must use HTTPS (HTTP is allowed only for localhost development)`);
	}
	if (url.pathname !== pathname || url.search || url.hash || url.username || url.password) {
		throw new Error(`${name} must be a base URL with path ${pathname}`);
	}
	return url.toString().replace(/\/+$/, "");
}

export function normalizeZosmaConfig(
	authBaseUrl: string,
	routerBaseUrl: string,
): { authBaseUrl: string; routerBaseUrl: string } {
	const auth = normalizeBaseUrl("Auth URL", authBaseUrl, "/");
	const router = normalizeBaseUrl("Router URL", routerBaseUrl, "/v1");
	const authUrl = new URL(auth);
	const routerUrl = new URL(router);
	if (authUrl.protocol !== routerUrl.protocol) {
		throw new Error("Auth URL and Router URL must use the same protocol");
	}
	if (
		authUrl.protocol === "http:" &&
		(!isLoopbackHost(authUrl.hostname) || !isLoopbackHost(routerUrl.hostname))
	) {
		throw new Error("HTTP router configuration is allowed only for localhost development");
	}
	return { authBaseUrl: auth, routerBaseUrl: router };
}
