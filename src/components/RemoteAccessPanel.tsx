import { invoke } from "@tauri-apps/api/core";
import {
	ArrowUpRight,
	Copy,
	Globe,
	Laptop,
	PowerOff,
	QrCode,
	RefreshCw,
	Shield,
	Wifi,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RemoteStatus {
	running: boolean;
	port?: number;
	host?: string;
	connectedClients?: number;
	pin?: string;
	localIPs?: string[];
}

// ---------------------------------------------------------------------------
// RemoteAccessPanel
// ---------------------------------------------------------------------------

export function RemoteAccessPanel() {
	const [status, setStatus] = useState<RemoteStatus | null>(null);
	const [loading, setLoading] = useState(false);
	const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
	const [copiedField, setCopiedField] = useState<string | null>(null);
	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const mountRef = useRef(true);

	// ── Fetch current status ────────────────────────────────────────

	const fetchStatus = useCallback(async () => {
		try {
			const result = await invoke<RemoteStatus>("get_remote_status");
			if (mountRef.current) setStatus(result);
			return result;
		} catch {
			if (mountRef.current) setStatus({ running: false });
			return null;
		}
	}, []);

	// ── Load initial status ─────────────────────────────────────────

	useEffect(() => {
		mountRef.current = true;
		fetchStatus();
		return () => {
			mountRef.current = false;
		};
	}, [fetchStatus]);

	// ── Generate QR code when server is running ─────────────────────

	useEffect(() => {
		if (!status?.running || !status.localIPs?.length) {
			setQrDataUrl(null);
			return;
		}

		let cancelled = false;
		const port = status.port ?? 8765;

		// Generate QR codes for all local IPs
		(async () => {
			const { toDataURL } = await import("qrcode");

			// Use the first non-localhost IP for the QR
			const primaryIP = status.localIPs?.[0];
			if (!primaryIP) return;

			const url = `http://${primaryIP}:${port}`;
			try {
				const dataUrl = await toDataURL(url, {
					width: 256,
					margin: 2,
					color: {
						dark: "#1a1a1a",
						light: "#ffffff",
					},
				});
				if (!cancelled) setQrDataUrl(dataUrl);
			} catch {
				// QR generation failed — non-critical
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [status?.running, status?.port, status?.localIPs]);

	// ── Poll status while server is running ─────────────────────────

	useEffect(() => {
		if (status?.running) {
			// Poll every 5 seconds for status updates (connected clients, PIN changes)
			pollRef.current = setInterval(() => {
				fetchStatus();
			}, 5000);
		} else {
			if (pollRef.current) {
				clearInterval(pollRef.current);
				pollRef.current = null;
			}
		}
		return () => {
			if (pollRef.current) {
				clearInterval(pollRef.current);
				pollRef.current = null;
			}
		};
	}, [status?.running, fetchStatus]);

	// ── Start / Stop server ─────────────────────────────────────────

	const handleToggle = useCallback(async () => {
		setLoading(true);
		try {
			if (status?.running) {
				await invoke("stop_remote_server");
			} else {
				await invoke("start_remote_server", {
					port: 8765,
					host: "0.0.0.0",
				});
			}
			// Small delay to let sidecar process the command
			await new Promise((r) => setTimeout(r, 300));
			await fetchStatus();
		} catch (err) {
			console.error("Remote server toggle failed:", err);
		} finally {
			setLoading(false);
		}
	}, [status?.running, fetchStatus]);

	// ── Copy to clipboard ────────────────────────────────────────────

	const copyToClipboard = useCallback(async (text: string, field: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopiedField(field);
			setTimeout(() => setCopiedField(null), 2000);
		} catch {
			// Clipboard API may not be available in Tauri webview
		}
	}, []);

	// ── Build URLs ───────────────────────────────────────────────────

	const port = status?.port ?? 8765;
	const urls = (status?.localIPs ?? []).map((ip) => ({
		ip,
		url: `http://${ip}:${port}`,
		label: ip.startsWith("100.") ? "Tailscale" : "Local",
	}));

	const hasTailscale = urls.some((u) => u.label === "Tailscale");

	return (
		<div className="rounded-lg border border-border bg-card overflow-hidden">
			{/* ── Header ────────────────────────────────────────── */}
			<div className="flex items-center justify-between p-4 bg-muted/10">
				<div className="flex items-center gap-3">
					<div
						className={`w-9 h-9 rounded-lg flex items-center justify-center ${
							status?.running
								? "bg-emerald-500/10 text-emerald-500"
								: "bg-muted/50 text-muted-foreground"
						}`}
					>
						<Wifi className="w-4 h-4" />
					</div>
					<div>
						<p className="text-sm font-medium text-foreground">Remote Access</p>
						<p className="text-xs text-muted-foreground">
							{status?.running ? `Active on port ${port}` : "Control Zosma Cowork from your phone"}
						</p>
					</div>
				</div>

				{/* ── Toggle switch ──────────────────────────────── */}
				<label className="relative inline-flex items-center cursor-pointer shrink-0">
					<input
						type="checkbox"
						className="sr-only peer"
						checked={status?.running ?? false}
						onChange={handleToggle}
						disabled={loading}
					/>
					<div
						className={`w-11 h-6 rounded-full peer transition-colors ${
							loading ? "bg-muted/50" : status?.running ? "bg-emerald-500" : "bg-muted"
						} peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-ring after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-background after:rounded-full after:h-5 after:w-5 after:transition-all ${
							status?.running ? "after:translate-x-full after:bg-white" : ""
						}`}
					/>
				</label>
			</div>

			{/* ── Status content (when running) ─────────────────── */}
			{status?.running && (
				<div className="p-4 space-y-4">
					{/* ── QR Code ─────────────────────────────────────── */}
					<div className="flex flex-col sm:flex-row items-start gap-4">
						<div className="shrink-0">
							{qrDataUrl ? (
								<div className="w-32 h-32 rounded-lg border border-border overflow-hidden bg-white p-1">
									<img src={qrDataUrl} alt="QR Code for remote access" className="w-full h-full" />
								</div>
							) : (
								<div className="w-32 h-32 rounded-lg border border-border bg-muted/20 flex items-center justify-center">
									<QrCode className="w-8 h-8 text-muted-foreground/30" />
								</div>
							)}
							<p className="text-[10px] text-muted-foreground/50 text-center mt-1">
								Scan to connect
							</p>
						</div>

						{/* ── Details ────────────────────────────────────── */}
						<div className="flex-1 min-w-0 space-y-2">
							{/* URLs */}
							{urls.length > 0 && (
								<div className="space-y-1.5">
									<p className="text-[11px] uppercase tracking-wider text-muted-foreground/40 font-medium">
										Connect via
									</p>
									{urls.map(({ ip, url, label }) => (
										<div key={ip} className="flex items-center gap-2 text-xs">
											{label === "Tailscale" ? (
												<Globe className="w-3.5 h-3.5 text-violet-400 shrink-0" />
											) : (
												<Laptop className="w-3.5 h-3.5 text-foreground/50 shrink-0" />
											)}
											<code className="font-mono text-foreground/80 bg-muted/30 px-1.5 py-0.5 rounded text-[11px] flex-1 truncate">
												{url}
											</code>
											<button
												type="button"
												onClick={() => copyToClipboard(url, `url-${ip}`)}
												className="p-1 rounded hover:bg-muted/50 transition-colors shrink-0"
												title="Copy URL"
											>
												<Copy className="w-3 h-3 text-muted-foreground/50" />
											</button>
											<span className="text-[10px] uppercase text-muted-foreground/40 font-medium shrink-0">
												{label}
											</span>
										</div>
									))}
								</div>
							)}

							{/* PIN */}
							<div className="flex items-center gap-2">
								<Shield className="w-3.5 h-3.5 text-amber-400 shrink-0" />
								<span className="text-xs text-foreground/60">Pairing PIN:</span>
								{status.pin ? (
									<>
										<code className="font-mono text-sm font-bold text-foreground bg-amber-500/10 px-2 py-0.5 rounded tracking-widest">
											{status.pin}
										</code>
										<button
											type="button"
											onClick={() => status.pin && copyToClipboard(status.pin, "pin")}
											className="p-1 rounded hover:bg-muted/50 transition-colors"
											title="Copy PIN"
										>
											{copiedField === "pin" ? (
												<span className="text-[10px] text-emerald-500">Copied!</span>
											) : (
												<Copy className="w-3 h-3 text-muted-foreground/50" />
											)}
										</button>
									</>
								) : (
									<span className="text-xs italic text-muted-foreground/50">Generating...</span>
								)}
							</div>

							{/* Connected clients */}
							<div className="flex items-center gap-2 text-xs text-muted-foreground">
								<ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
								<span>
									{status.connectedClients ?? 0} connected client
									{status.connectedClients !== 1 ? "s" : ""}
								</span>
							</div>
						</div>
					</div>

					{/* ── Info box ─────────────────────────────────────── */}
					<div className="rounded-lg bg-muted/20 border border-border p-3 space-y-2">
						{/* Local access info */}
						<div className="flex gap-2 text-xs text-muted-foreground">
							<Shield className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
							<div>
								<p className="font-medium text-foreground/80">Same-network only</p>
								<p className="text-muted-foreground/60">
									Your phone must be on the same Wi-Fi network as this computer. The QR code and
									URLs above only work locally.
								</p>
							</div>
						</div>

						{/* Outside access info */}
						<div className="flex gap-2 text-xs text-muted-foreground">
							<Globe className="w-3.5 h-3.5 text-violet-400 shrink-0 mt-0.5" />
							<div>
								<p className="font-medium text-foreground/80">Outside home network</p>
								<p className="text-muted-foreground/60">
									{hasTailscale
										? "Tailscale detected! The 100.x.x.x URL works from anywhere as long as Tailscale is running on both devices."
										: "For remote access from outside your home, install Tailscale on both devices or use ngrok. See FAQ for setup guides."}
								</p>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* ── Idle state (not running) ───────────────────────── */}
			{!status?.running && (
				<div className="p-6 text-center space-y-2">
					<div className="w-12 h-12 rounded-full bg-muted/30 mx-auto flex items-center justify-center">
						<PowerOff className="w-5 h-5 text-muted-foreground/40" />
					</div>
					<p className="text-sm text-muted-foreground">Remote access is disabled</p>
					<p className="text-xs text-muted-foreground/50 max-w-sm mx-auto">
						Enable it above to control Zosma Cowork from your phone or another device on your
						network.
					</p>
				</div>
			)}

			{/* ── Error / loading state ──────────────────────────── */}
			{loading && (
				<div className="absolute inset-0 bg-background/50 flex items-center justify-center rounded-lg">
					<RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
				</div>
			)}
		</div>
	);
}
