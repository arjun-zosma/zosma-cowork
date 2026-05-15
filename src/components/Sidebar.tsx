import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

import { THEMES, applyTheme, getSavedTheme } from "@/lib/themes";
import type { Theme } from "@/lib/themes";
import {
	Check,
	Info,
	Key,
	MessageSquare,
	NotebookPen,
	Package,
	Palette,
	Search,
	Settings,
	ShieldCheck,
} from "lucide-react";
import { ConversationSearch } from "./ConversationSearch";
import { ExtensionPanel } from "./ExtensionPanel";
import { FeedbackDialog } from "./FeedbackDialog";
import { PromptTemplates } from "./PromptTemplates";
import { ProviderAuthSection } from "./ProviderAuthSection";
import { SkillsPanel } from "./SkillsPanel";

interface Session {
	id: string;
	title: string;
	lastMessage: string;
	timestamp: number;
	active?: boolean;
}

interface SidebarProps {
	view: string;
	sessions: Session[];
	activeSessionId?: string;
	onSessionSelect: (id: string) => void;
	onNewSession: () => void;
	onDeleteSession: (id: string) => void;
	onChangeView: (view: string) => void;
	onShowKeyEntry?: () => void;
	telemetryEnabled?: boolean;
	onTelemetryToggle?: (enabled: boolean) => void;
	onSend?: (prompt: string) => void;
}

export function Sidebar({
	view,
	sessions,
	activeSessionId,
	onSessionSelect,
	onNewSession,
	onDeleteSession,
	onChangeView,
	onShowKeyEntry,
	telemetryEnabled,
	onTelemetryToggle,
	onSend,
}: SidebarProps) {
	const isSettings = view === "settings";
	const isExtensions = view === "extensions";
	const isTemplates = view === "templates";
	const isSkills = view === "skills";
	const [showFeedback, setShowFeedback] = useState(false);

	return (
		<div className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col">
			{/* Content area */}
			{isSettings ? (
				<SettingsPanel
					onShowKeyEntry={onShowKeyEntry}
					telemetryEnabled={telemetryEnabled}
					onTelemetryToggle={onTelemetryToggle}
					onShowFeedback={() => setShowFeedback(true)}
				/>
			) : isExtensions ? (
				<ExtensionPanel onReload={() => {}} />
			) : isTemplates && onSend ? (
				<PromptTemplates onSend={onSend} />
			) : isSkills ? (
				<SkillsPanel />
			) : (
				<ConversationSearch
					sessions={sessions}
					activeSessionId={activeSessionId}
					onSelect={onSessionSelect}
					onNewSession={onNewSession}
					onDeleteSession={onDeleteSession}
				/>
			)}

			{/* Bottom tab bar */}
			<div className="shrink-0 border-t border-sidebar-border flex items-center justify-around px-2 py-1.5">
				<TabButton
					icon={MessageSquare}
					label="Chats"
					active={view === "chats"}
					onClick={() => onChangeView("chats")}
				/>
				<TabButton
					icon={NotebookPen}
					label="Templates"
					active={isTemplates}
					onClick={() => onChangeView("templates")}
				/>
				<TabButton
					icon={Package}
					label="Exts"
					active={isExtensions}
					onClick={() => onChangeView("extensions")}
				/>
				<TabButton
					icon={Search}
					label="Skills"
					active={isSkills}
					onClick={() => onChangeView("skills")}
				/>
				<TabButton
					icon={Settings}
					label="Settings"
					active={isSettings}
					onClick={() => onChangeView("settings")}
				/>
			</div>

			{/* Feedback Dialog */}
			<FeedbackDialog open={showFeedback} onClose={() => setShowFeedback(false)} />
		</div>
	);
}


// ─── Settings Panel ─────────────────────────────────────────────────

function SettingsPanel({
	onShowKeyEntry,
	telemetryEnabled,
	onTelemetryToggle,
	onShowFeedback,
}: {
	onShowKeyEntry?: () => void;
	telemetryEnabled?: boolean;
	onTelemetryToggle?: (enabled: boolean) => void;
	onShowFeedback?: () => void;
}) {
	const [appVersion, setAppVersion] = useState<string | null>(null);
	const [currentTheme, setCurrentTheme] = useState(getSavedTheme);

	useEffect(() => {
		import("@tauri-apps/api/app")
			.then(({ getVersion }) => getVersion().then(setAppVersion))
			.catch(() => {});
	}, []);

	function handleThemeChange(theme: Theme) {
		applyTheme(theme);
		setCurrentTheme(theme);
	}

	return (
		<>
			<div className="flex items-center px-3 py-2">
				<span className="text-xs font-semibold text-sidebar-foreground/70 uppercase tracking-wider">
					Settings
				</span>
			</div>
			<ScrollArea className="flex-1 px-3 py-2">
				<div className="space-y-5">
					{/* ── Authentication ── */}
					<div>
						<div className="flex items-center gap-1.5 mb-2">
							<Key className="w-3.5 h-3.5 text-sidebar-foreground/50" />
							<span className="text-xs font-medium text-sidebar-foreground/70">Authentication</span>
						</div>
						<div
							className="rounded-lg border p-2.5 space-y-2.5"
							style={{
								borderColor: "hsl(var(--sidebar-border))",
								background: "hsl(var(--sidebar-background) / 0.5)",
							}}
						>
							<OAuthRow provider="anthropic" icon="🤖" />
							<OAuthRow provider="github-copilot" icon="🐙" />
							<OAuthRow provider="openai-codex" icon="💬" />
							<div
								className="h-px"
								style={{ background: "hsl(var(--sidebar-border))" }}
							/>
							<div>
								<p className="text-[10px] text-sidebar-foreground/50 mb-2">
									Or use an API key for other providers.
								</p>
								<button
									type="button"
									onClick={onShowKeyEntry}
									className="w-full text-xs px-3 py-1.5 rounded-lg transition-colors text-center"
									style={{
										background: "hsl(var(--sidebar-accent))",
										color: "hsl(var(--sidebar-accent-foreground))",
									}}
								>
									Change API Key
								</button>
							</div>
						</div>
					</div>

					{/* ── Themes ── */}
					<div>
						<div className="flex items-center gap-1.5 mb-2">
							<Palette className="w-3.5 h-3.5 text-sidebar-foreground/50" />
							<span className="text-xs font-medium text-sidebar-foreground/70">Theme</span>
						</div>
						<div className="space-y-1.5">
							{THEMES.map((theme) => {
								const isActive = currentTheme.id === theme.id;
								// Extract accent color sample
								const accentSample = theme.vars.primary || "255 70% 65%";
								const bgSample = theme.vars.background || "215 20% 8%";
								return (
									<button
										key={theme.id}
										type="button"
										onClick={() => handleThemeChange(theme)}
										className="w-full text-left px-2.5 py-2 rounded-lg transition-colors flex items-center gap-2.5"
										style={{
											background: isActive ? "hsl(var(--sidebar-accent))" : "transparent",
										}}
									>
										{/* Theme preview swatch */}
										<div
											className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center border"
											style={{
												background: `hsl(${bgSample})`,
												borderColor: `hsl(${theme.vars.border || "215 15% 20%"})`,
											}}
										>
											<div
												className="w-3 h-3 rounded-full"
												style={{ background: `hsl(${accentSample})` }}
											/>
										</div>
										<div className="flex-1 min-w-0">
											<div className="flex items-center gap-1.5">
												<span
													className="text-xs font-medium truncate"
													style={{ color: "hsl(var(--sidebar-foreground))" }}
												>
													{theme.name}
												</span>
												<span className="text-[10px] uppercase text-sidebar-foreground/30">
													{theme.type}
												</span>
												{isActive && (
													<Check
														className="w-3 h-3 ml-auto shrink-0"
														style={{ color: "hsl(var(--primary))" }}
													/>
												)}
											</div>
											<p className="text-[10px] text-sidebar-foreground/50 truncate mt-0.5">
												{theme.description}
											</p>
										</div>
									</button>
								);
							})}
						</div>
					</div>

					{/* ── Telemetry ── */}
					{onTelemetryToggle && (
						<div>
							<div className="flex items-center gap-1.5 mb-2">
								<ShieldCheck className="w-3.5 h-3.5 text-sidebar-foreground/50" />
								<span className="text-xs font-medium text-sidebar-foreground/70">
									Telemetry
								</span>
							</div>
							<div
								className="rounded-lg border p-2.5"
								style={{
									borderColor: "hsl(var(--sidebar-border))",
									background: "hsl(var(--sidebar-background) / 0.5)",
								}}
							>
								<div className="flex items-center justify-between">
									<div className="flex-1 min-w-0">
										<p className="text-xs text-sidebar-foreground">
											Share anonymous usage data and crash reports
										</p>
										<p className="text-[10px] text-sidebar-foreground/50 mt-0.5">
											Nothing is sent unless this is enabled.
										</p>
									</div>
									<label className="relative inline-flex items-center cursor-pointer">
										<input
											type="checkbox"
											className="sr-only peer"
											checked={telemetryEnabled ?? false}
											onChange={(e) => onTelemetryToggle(e.target.checked)}
										/>
										<div className="w-9 h-5 bg-sidebar-border rounded-full peer peer-checked:bg-primary peer-focus:outline-none peer-focus:ring-1 peer-focus:ring-ring after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-sidebar-foreground after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full peer-checked:after:bg-primary-foreground" />
									</label>
								</div>
							</div>
						</div>
					)}

					{/* ── Feedback ── */}
					{onShowFeedback && (
						<button
							type="button"
							onClick={onShowFeedback}
							className="w-full flex items-center gap-2 px-2.5 py-2 text-xs text-sidebar-foreground hover:bg-sidebar-background/50 rounded-lg transition-colors"
						>
							<MessageSquare className="w-3.5 h-3.5 text-sidebar-foreground/50" />
							Send Feedback
						</button>
					)}

					{/* ── About ── */}
					<div>
						<div className="flex items-center gap-1.5 mb-2">
							<Info className="w-3.5 h-3.5 text-sidebar-foreground/50" />
							<span className="text-xs font-medium text-sidebar-foreground/70">About</span>
						</div>
						<div
							className="rounded-lg border p-2.5"
							style={{
								borderColor: "hsl(var(--sidebar-border))",
								background: "hsl(var(--sidebar-background) / 0.5)",
							}}
						>
							<div className="flex items-center gap-2 mb-1">
								<div
									className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold"
									style={{
										background: "hsl(var(--primary) / 0.15)",
										color: "hsl(var(--primary))",
									}}
								>
									Z
								</div>
								<div>
									<div
										className="text-xs font-medium"
										style={{ color: "hsl(var(--sidebar-foreground))" }}
									>
										Zosma Cowork
									</div>
									<div className="text-[10px] text-sidebar-foreground/50">
										{appVersion ? `v${appVersion}` : "..."} · Built with pi-mono
									</div>
								</div>
							</div>
							<p className="text-[10px] text-sidebar-foreground/40 mt-1">
								AI-powered coding assistant by Zosma AI
							</p>
						</div>
					</div>
				</div>
			</ScrollArea>
		</>
	);
}

// ─── OAuth Row (compact provider with icon) ─────────────────────────

function OAuthRow({
	provider,
	icon,
}: {
	provider: string;
	icon: string;
}) {
	return (
		<div className="flex items-start gap-2">
			<span className="text-base mt-0.5 shrink-0">{icon}</span>
			<div className="flex-1 min-w-0">
				<ProviderAuthSection provider={provider} compact />
			</div>
		</div>
	);
}

// ─── Tab Button ─────────────────────────────────────────────────────

function TabButton({
	icon: Icon,
	label,
	active,
	onClick,
}: {
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex flex-col items-center gap-0.5 px-3 py-1 rounded-md transition-colors",
				active
					? "text-sidebar-accent-foreground bg-sidebar-accent"
					: "text-sidebar-foreground/40 hover:text-sidebar-foreground/70 hover:bg-sidebar-accent/30",
			)}
		>
			<Icon className="w-4 h-4" />
			<span className="text-[10px]">{label}</span>
		</button>
	);
}


