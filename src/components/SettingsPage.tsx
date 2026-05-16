import { ScrollArea } from "@/components/ui/scroll-area";
import { CustomInstructions } from "./CustomInstructions";
import { ExtensionPanel } from "./ExtensionPanel";
import { FeedbackDialog } from "./FeedbackDialog";
import { ProviderAuthSection } from "./ProviderAuthSection";
import { SkillsPanel } from "./SkillsPanel";
import { THEMES, applyTheme, getSavedTheme } from "@/lib/themes";
import type { Theme } from "@/lib/themes";
import {
	Check,
	Info,
	Key,
	MessageSquare,
	Package,
	Palette,
	Puzzle,
	Settings,
	ShieldCheck,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface SettingsPageProps {
	onClose: () => void;
	onShowKeyEntry?: () => void;
	telemetryEnabled?: boolean;
	onTelemetryToggle?: (enabled: boolean) => void;
}

export function SettingsPage({
	onClose,
	onShowKeyEntry,
	telemetryEnabled,
	onTelemetryToggle,
}: SettingsPageProps) {
	const [appVersion, setAppVersion] = useState<string | null>(null);
	const [currentTheme, setCurrentTheme] = useState(getSavedTheme);
	const [showFeedback, setShowFeedback] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		import("@tauri-apps/api/app")
			.then(({ getVersion }) => getVersion().then(setAppVersion))
			.catch(() => {});
	}, []);

	// Close on Escape
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !showFeedback) {
				onClose();
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [onClose, showFeedback]);

	// Focus trap: auto-focus the container on mount
	useEffect(() => {
		containerRef.current?.focus();
	}, []);

	function handleThemeChange(theme: Theme) {
		applyTheme(theme);
		setCurrentTheme(theme);
	}

	return (
		<div
			ref={containerRef}
			tabIndex={-1}
			className="h-full flex flex-col bg-background"
		>
			{/* Header */}
			<header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
				<div className="flex items-center gap-2">
					<Settings className="w-4 h-4 text-foreground/60" />
					<h1 className="text-sm font-semibold text-foreground">Settings</h1>
				</div>
				<button
					type="button"
					aria-label="Close settings"
					onClick={onClose}
					className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
				>
					<X className="w-4 h-4" />
				</button>
			</header>

			<ScrollArea className="flex-1 px-6 py-5">
				<div className="max-w-2xl mx-auto space-y-8">
					{/* ── Authentication ── */}
					<section>
						<div className="flex items-center gap-2 mb-3">
							<Key className="w-4 h-4 text-foreground/50" />
							<h2 className="text-sm font-semibold text-foreground">
								Authentication
							</h2>
						</div>
						<div className="rounded-lg border border-border bg-card p-4 space-y-3">
							<ProviderOAuthRow provider="anthropic" icon="🤖" />
							<ProviderOAuthRow provider="github-copilot" icon="🐙" />
							<ProviderOAuthRow provider="openai-codex" icon="💬" />
							<div className="h-px bg-border" />
							<div>
								<p className="text-xs text-muted-foreground mb-2">
									Or use an API key for other providers.
								</p>
								{onShowKeyEntry && (
									<button
										type="button"
										onClick={onShowKeyEntry}
										className="text-xs px-3 py-1.5 rounded-lg transition-colors text-center bg-primary/10 text-primary hover:bg-primary/15"
									>
										Change API Key
									</button>
								)}
							</div>
						</div>
					</section>

					{/* ── Extensions ── */}
					<section>
						<div className="flex items-center gap-2 mb-3">
							<Puzzle className="w-4 h-4 text-foreground/50" />
							<h2 className="text-sm font-semibold text-foreground">
								Extensions
							</h2>
						</div>
						<div className="rounded-lg border border-border bg-card p-4">
							<ExtensionPanel onReload={() => {}} />
						</div>
					</section>

					{/* ── Skills ── */}
					<section>
						<div className="flex items-center gap-2 mb-3">
							<Package className="w-4 h-4 text-foreground/50" />
							<h2 className="text-sm font-semibold text-foreground">Skills</h2>
						</div>
						<div className="rounded-lg border border-border bg-card p-4">
							<SkillsPanel />
						</div>
					</section>

					{/* ── Custom Instructions ── */}
					<section>
						<div className="flex items-center gap-2 mb-3">
							<MessageSquare className="w-4 h-4 text-foreground/50" />
							<h2 className="text-sm font-semibold text-foreground">
								Custom Instructions
							</h2>
						</div>
						<div className="rounded-lg border border-border bg-card p-4">
							<CustomInstructions />
						</div>
					</section>

					{/* ── Theme ── */}
					<section>
						<div className="flex items-center gap-2 mb-3">
							<Palette className="w-4 h-4 text-foreground/50" />
							<h2 className="text-sm font-semibold text-foreground">Theme</h2>
						</div>
						<div className="space-y-1.5">
							{THEMES.map((theme) => {
								const isActive = currentTheme.id === theme.id;
								const accentSample = theme.vars.primary || "255 70% 65%";
								const bgSample = theme.vars.background || "215 20% 8%";
								return (
									<button
										key={theme.id}
										type="button"
										onClick={() => handleThemeChange(theme)}
										className="w-full text-left px-3 py-2.5 rounded-lg transition-colors flex items-center gap-3 hover:bg-muted/30"
										style={{
											background: isActive
												? "hsl(var(--accent) / 0.3)"
												: "transparent",
										}}
									>
										<div
											className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center border"
											style={{
												background: `hsl(${bgSample})`,
												borderColor: `hsl(${theme.vars.border || "215 15% 20%"})`,
											}}
										>
											<div
												className="w-3.5 h-3.5 rounded-full"
												style={{ background: `hsl(${accentSample})` }}
											/>
										</div>
										<div className="flex-1 min-w-0">
											<div className="flex items-center gap-2">
												<span className="text-sm font-medium text-foreground truncate">
													{theme.name}
												</span>
												<span className="text-[10px] uppercase text-muted-foreground/40">
													{theme.type}
												</span>
												{isActive && (
													<Check className="w-3.5 h-3.5 ml-auto shrink-0 text-primary" />
												)}
											</div>
											<p className="text-xs text-muted-foreground/60 truncate mt-0.5">
												{theme.description}
											</p>
										</div>
									</button>
								);
							})}
						</div>
					</section>

					{/* ── Telemetry ── */}
					{onTelemetryToggle && (
						<section>
							<div className="flex items-center gap-2 mb-3">
								<ShieldCheck className="w-4 h-4 text-foreground/50" />
								<h2 className="text-sm font-semibold text-foreground">
									Telemetry
								</h2>
							</div>
							<div className="rounded-lg border border-border bg-card p-4">
								<div className="flex items-center justify-between">
									<div className="flex-1 min-w-0">
										<p className="text-sm text-foreground">
											Share anonymous usage data and crash reports
										</p>
										<p className="text-xs text-muted-foreground mt-1">
											Nothing is sent unless this is enabled. Helps improve the app.
										</p>
									</div>
									<label className="relative inline-flex items-center cursor-pointer shrink-0 ml-3">
										<input
											type="checkbox"
											className="sr-only peer"
											checked={telemetryEnabled ?? false}
											onChange={(e) => onTelemetryToggle(e.target.checked)}
										/>
										<div className="w-10 h-5 bg-muted rounded-full peer peer-checked:bg-primary peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-ring after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-background after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full peer-checked:after:bg-primary-foreground" />
									</label>
								</div>
							</div>
						</section>
					)}

					{/* ── Feedback ── */}
					<section>
						<button
							type="button"
							onClick={() => setShowFeedback(true)}
							className="flex items-center gap-2 px-3 py-2.5 text-sm text-foreground hover:bg-muted/30 rounded-lg transition-colors w-full"
						>
							<MessageSquare className="w-4 h-4 text-foreground/50" />
							Send Feedback
						</button>
					</section>

					{/* ── About ── */}
					<section>
						<div className="flex items-center gap-2 mb-3">
							<Info className="w-4 h-4 text-foreground/50" />
							<h2 className="text-sm font-semibold text-foreground">About</h2>
						</div>
						<div className="rounded-lg border border-border bg-card p-4 space-y-2">
							<p className="text-sm text-foreground">Zosma Cowork</p>
							<p className="text-xs text-muted-foreground">
								India's first Non-Coding Agentic Work Harness
							</p>
							<div className="h-px bg-border" />
							<p className="text-xs text-muted-foreground">
								Version:{" "}
								{appVersion ? (
									<span className="font-mono text-foreground/70">{appVersion}</span>
								) : (
									<span className="italic">loading...</span>
								)}
							</p>
							<p className="text-xs text-muted-foreground">
								Built on{" "}
								<a
									href="https://github.com/earendil-works/pi-mono"
									target="_blank"
									rel="noopener noreferrer"
									className="underline hover:text-foreground"
								>
									pi-mono SDK
								</a>
							</p>
						</div>
					</section>
				</div>
			</ScrollArea>

			{/* Feedback Dialog */}
			<FeedbackDialog open={showFeedback} onClose={() => setShowFeedback(false)} />
		</div>
	);
}

// ─── OAuth Row ────────────────────────────────────────────────────

function ProviderOAuthRow({
	provider,
	icon,
}: {
	provider: string;
	icon: string;
}) {
	return (
		<div className="flex items-start gap-2 py-0.5">
			<span className="text-base mt-0.5 shrink-0">{icon}</span>
			<div className="flex-1 min-w-0">
				<ProviderAuthSection provider={provider} compact />
			</div>
		</div>
	);
}
