/**
 * RouterSetupScreen — first-run Zosma Router configuration.
 *
 * Shown after splash when the router hasn't been connected yet.
 * 1. User enters auth + router base URLs
 * 2. Calls configure_router to save them in the sidecar
 * 3. Then runs the Zosma device auth flow
 * 4. On completion, fires onDone to let the app proceed
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@tauri-apps/api/core";
import { useState } from "react";

interface Props {
	onDone: () => void;
}

const DEFAULT_AUTH_URL = "http://localhost:3000";
const DEFAULT_ROUTER_URL = "http://localhost:3000/v1";

export function RouterSetupScreen({ onDone }: Props) {
	const [authBaseUrl, setAuthBaseUrl] = useState(DEFAULT_AUTH_URL);
	const [routerBaseUrl, setRouterBaseUrl] = useState(DEFAULT_ROUTER_URL);
	const [phase, setPhase] = useState<"idle" | "saving" | "authorizing" | "done" | "error">("idle");
	const [error, setError] = useState<string | null>(null);

	const handleSaveAndConnect = async () => {
		setError(null);
		setPhase("saving");

		try {
			if (isTauri()) {
				// 1. Configure URLs on the sidecar
				await invoke("configure_router", {
					authBaseUrl: authBaseUrl.replace(/\/+$/, ""),
					routerBaseUrl: routerBaseUrl.replace(/\/+$/, ""),
				});
			}

			setPhase("authorizing");

			// 2. Start device auth flow — opens browser
			const result = await invoke<{ authorizationUrl: string }>("start_zosma_auth");
			if (!result.authorizationUrl) {
				setPhase("error");
				setError("Auth server returned no authorization URL");
				return;
			}

			// 3. Open system browser
			await invoke("open_url", { url: result.authorizationUrl });

			// The deep-link listener in useZosmaAuth handles the callback.
			// For the setup screen we rely on the auth completing via deep-link
			// and config-reload event.
			setPhase("done");

			// Short delay then proceed
			setTimeout(() => onDone(), 500);
		} catch (err: unknown) {
			setPhase("error");
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	return (
		<div className="flex-1 flex flex-col items-center justify-center min-h-0 p-8">
			<div className="max-w-md w-full space-y-6">
				<div className="text-center space-y-2">
					<h1 className="text-2xl font-semibold text-foreground">
						Connect Zosma Router
					</h1>
					<p className="text-sm text-muted-foreground">
						Enter your Zosma Router URLs to connect. These are saved for future sessions.
					</p>
				</div>

				<div className="space-y-4">
					<div className="space-y-2">
						<label className="text-sm font-medium text-foreground" htmlFor="auth-url">
							Auth Base URL
						</label>
						<input
							id="auth-url"
							type="text"
							value={authBaseUrl}
							onChange={(e) => setAuthBaseUrl(e.target.value)}
							className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
							placeholder="http://localhost:3000"
							disabled={phase !== "idle"}
						/>
					</div>

					<div className="space-y-2">
						<label className="text-sm font-medium text-foreground" htmlFor="router-url">
							Router Base URL
						</label>
						<input
							id="router-url"
							type="text"
							value={routerBaseUrl}
							onChange={(e) => setRouterBaseUrl(e.target.value)}
							className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
							placeholder="http://localhost:3000/v1"
							disabled={phase !== "idle"}
						/>
					</div>
				</div>

				{error && (
					<div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
						{error}
					</div>
				)}

				<button
					type="button"
					onClick={handleSaveAndConnect}
					disabled={phase === "saving" || phase === "authorizing"}
					className="w-full py-2.5 px-4 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
				>
					{phase === "saving"
						? "Saving configuration…"
						: phase === "authorizing"
							? "Opening browser…"
							: "Save & Connect"}
				</button>
			</div>
		</div>
	);
}
