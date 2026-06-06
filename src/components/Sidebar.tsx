import { MessageSquare, NotebookPen, Settings } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ConversationSearch } from "./ConversationSearch";
import { PromptTemplates } from "./PromptTemplates";

interface Session {
	id: string;
	title: string;
	lastMessage: string;
	timestamp: number;
	active?: boolean;
	/** Workspace folder this session ran in (drives folder grouping). */
	folder?: string;
}

interface SidebarProps {
	view: string;
	sessions: Session[];
	activeSessionId?: string;
	onSessionSelect: (id: string) => void;
	onNewSession: () => void;
	onDeleteSession: (id: string) => void;
	onChangeView: (view: string) => void;
	/** Load a prompt template into the composer for editing (does not send). */
	onUseTemplate?: (prompt: string) => void;
	/** The user's home dir, used to collapse session paths to `~`. */
	homeDir?: string;
}

const TABS = [
	{ id: "chats", label: "Chats", Icon: MessageSquare },
	{ id: "templates", label: "Templates", Icon: NotebookPen },
] as const;

// ease-out-expo
const easeOutExpo = [0.16, 1, 0.3, 1] as const;

export function Sidebar({
	view,
	sessions,
	activeSessionId,
	onSessionSelect,
	onNewSession,
	onDeleteSession,
	onChangeView,
	onUseTemplate,
	homeDir,
}: SidebarProps) {
	const reduced = useReducedMotion();
	const activeTab: "chats" | "templates" = view === "templates" ? "templates" : "chats";

	return (
		<motion.div
			className="w-72 flex flex-col h-full overflow-hidden md:rounded-2xl panel-sidebar"
			initial={reduced ? false : { x: -12, opacity: 0 }}
			animate={{ x: 0, opacity: 1 }}
			transition={{ duration: 0.32, ease: easeOutExpo }}
		>
			{/* ── Brand header ── */}
			<div className="flex items-center gap-2.5 px-4 pt-4 pb-3 shrink-0">
				<motion.div
					className="shimmer relative w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
					style={{
						background:
							"linear-gradient(135deg, hsl(var(--primary) / 0.9), hsl(142 60% 40% / 0.85))",
						boxShadow:
							"0 4px 14px -4px hsl(var(--primary) / 0.55), inset 0 1px 0 hsl(0 0% 100% / 0.35)",
					}}
					whileHover={reduced ? {} : { scale: 1.06, rotate: -3 }}
					transition={{ duration: 0.25, ease: easeOutExpo }}
				>
					<span
						className="text-base font-bold leading-none"
						style={{ color: "hsl(var(--primary-foreground))" }}
					>
						Z
					</span>
				</motion.div>
				<div className="flex flex-col min-w-0">
					<span
						className="text-[13px] font-semibold leading-tight tracking-tight truncate"
						style={{ color: "hsl(var(--sidebar-foreground))" }}
					>
						Zosma Cowork
					</span>
					<span
						className="text-[10px] leading-tight truncate"
						style={{ color: "hsl(var(--muted-foreground) / 0.6)" }}
					>
						AI workspace
					</span>
				</div>
			</div>

			{/* ── Tab switcher ── */}
			<div className="px-3 pt-1 pb-0 shrink-0">
				<div
					className="relative flex items-center gap-px rounded-xl p-1"
					style={{ background: "hsl(var(--muted) / 0.5)" }}
				>
					{/* Sliding pill — always mounted, position driven by animate */}
					<motion.div
						className="absolute top-1 bottom-1 rounded-lg"
						animate={{
							left: activeTab === "chats" ? 4 : "50%",
							width: "calc(50% - 4px)",
						}}
						initial={false}
						transition={{ duration: reduced ? 0 : 0.22, ease: easeOutExpo }}
						style={{
							background: "hsl(var(--sidebar-background))",
							boxShadow: "0 1px 4px hsl(0 0% 0% / 0.12)",
						}}
					/>

					{TABS.map(({ id, label, Icon }) => (
						<button
							key={id}
							type="button"
							onClick={() => onChangeView(id)}
							className="relative z-10 flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors"
							style={{
								color:
									activeTab === id
										? "hsl(var(--sidebar-foreground))"
										: "hsl(var(--sidebar-foreground) / 0.45)",
							}}
						>
							<Icon className="w-3.5 h-3.5 shrink-0" />
							{label}
						</button>
					))}
				</div>
			</div>

			{/* ── Content area ── */}
			<div className="flex-1 min-h-0 relative overflow-hidden">
				<AnimatePresence mode="wait" initial={false}>
					{activeTab === "templates" && onUseTemplate ? (
						<motion.div
							key="templates"
							className="absolute inset-0"
							initial={reduced ? { opacity: 0 } : { opacity: 0, x: 16 }}
							animate={{ opacity: 1, x: 0 }}
							exit={reduced ? { opacity: 0 } : { opacity: 0, x: -16 }}
							transition={{ duration: 0.2, ease: easeOutExpo }}
						>
							<PromptTemplates onUseTemplate={onUseTemplate} />
						</motion.div>
					) : (
						<motion.div
							key="chats"
							className="absolute inset-0"
							initial={reduced ? { opacity: 0 } : { opacity: 0, x: -16 }}
							animate={{ opacity: 1, x: 0 }}
							exit={reduced ? { opacity: 0 } : { opacity: 0, x: 16 }}
							transition={{ duration: 0.2, ease: easeOutExpo }}
						>
							<ConversationSearch
								sessions={sessions}
								activeSessionId={activeSessionId}
								onSelect={onSessionSelect}
								onNewSession={onNewSession}
								onDeleteSession={onDeleteSession}
								homeDir={homeDir}
							/>
						</motion.div>
					)}
				</AnimatePresence>
			</div>

			{/* ── Settings footer ── */}
			<div
				className="shrink-0 px-3 py-2"
				style={{ borderTop: "1px solid hsl(var(--sidebar-border))" }}
			>
				<motion.button
					type="button"
					onClick={() => onChangeView("settings")}
					className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] transition-colors"
					style={{ color: "hsl(var(--sidebar-foreground) / 0.45)" }}
					whileHover={
						reduced
							? {}
							: {
									color: "hsl(var(--sidebar-foreground))",
									background: "hsl(var(--sidebar-accent) / 0.5)",
								}
					}
					whileTap={reduced ? {} : { scale: 0.97 }}
					transition={{ duration: 0.15, ease: easeOutExpo }}
				>
					<Settings className="w-3.5 h-3.5 shrink-0" />
					Settings
				</motion.button>
			</div>
		</motion.div>
	);
}
