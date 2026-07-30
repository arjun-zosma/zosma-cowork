/**
 * RouterSetupScreen — first-run Zosma Router URL configuration.
 *
 * Shown after splash when zosmaai-router isn't in apiKeyProviders yet.
 * Just saves the base URLs and dismisses — the actual Sign in with Zosma
 * flow happens in HomeView via useZosmaAuth (which handles deep-link).
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
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSave = async () => {
		setError(null);
		setSaving(true);
		try {
			if (isTauri()) {
				await invoke("configure_router", {
					authBaseUrl: authBaseUrl.replace(/\/+$/, ""),
					routerBaseUrl: routerBaseUrl.replace(/\/+$/, ""),
				});
			}
			onDone();
		} catch (err: unknown) {
			setSaving(false);
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
						Enter your Zosma Router URLs to connect. Then sign in with Zosma on the next screen.
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
							disabled={saving}
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
							disabled={saving}
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
					onClick={handleSave}
					disabled={saving}
					className="w-full py-2.5 px-4 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
				>
					{saving ? "Saving…" : "Save & Continue"}
				</button>
			</div>
		</div>
	);
}
