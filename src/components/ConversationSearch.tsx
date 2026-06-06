import { Folder, FolderPlus, MessagesSquare, Search, Trash2 } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo, useRef, useState } from "react";

interface Session {
	id: string;
	title: string;
	lastMessage: string;
	timestamp: number;
	active?: boolean;
	/** Workspace folder this session was opened in (shown VSCode-style). */
	folder?: string;
}

/**
 * Render a session's folder the way editors show recent-project paths: home is
 * collapsed to `~`, paths under home become `~/sub/dir`, everything else is the
 * absolute path. Missing folder (legacy sessions) is treated as home.
 */
function displayPath(folder: string | undefined, homeDir: string | undefined): string {
	if (!folder) return "~";
	if (!homeDir) return folder;
	const home = homeDir.replace(/[/\\]+$/, "");
	if (folder === home) return "~";
	if (folder.startsWith(`${home}/`) || folder.startsWith(`${home}\\`)) {
		return `~/${folder.slice(home.length + 1).replace(/\\/g, "/")}`;
	}
	return folder;
}

interface ConversationSearchProps {
	sessions: Session[];
	onSelect: (id: string) => void;
	onNewSession: () => void;
	onDeleteSession: (id: string) => void;
	activeSessionId?: string;
	/** The user's home dir, used to collapse session paths to `~`. */
	homeDir?: string;
}

function formatTime(ts: number): string {
	const d = new Date(ts);
	const now = new Date();
	const diff = now.getTime() - d.getTime();
	if (diff < 60_000) return "Just now";
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
	const yesterday = new Date(now);
	yesterday.setDate(yesterday.getDate() - 1);
	if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
	return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

const easeOutExpo = [0.16, 1, 0.3, 1] as const;

export function ConversationSearch({
	sessions,
	onSelect,
	onNewSession,
	onDeleteSession,
	activeSessionId,
	homeDir,
}: ConversationSearchProps) {
	const [query, setQuery] = useState("");
	const [focused, setFocused] = useState(false);
	const reduced = useReducedMotion();
	const inputRef = useRef<HTMLInputElement>(null);

	const filtered = useMemo(() => {
		if (!query.trim()) return sessions;
		const q = query.toLowerCase();
		return sessions.filter(
			(s) => s.title.toLowerCase().includes(q) || s.lastMessage.toLowerCase().includes(q),
		);
	}, [sessions, query]);

	return (
		<div className="flex flex-col h-full min-h-0">
			{/* ── Header ── */}
			<div className="flex items-center justify-between px-4 pt-3 pb-2">
				<span
					className="text-[10px] font-semibold uppercase tracking-widest"
					style={{ color: "hsl(var(--muted-foreground) / 0.5)" }}
				>
					Sessions
				</span>
				<motion.button
					type="button"
					onClick={onNewSession}
					aria-label="New session"
					title="New session — pick a folder for the agent to work in"
					className="shimmer flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium"
					style={{
						color: "hsl(var(--primary))",
						background: "hsl(var(--primary) / 0.1)",
						boxShadow: "inset 0 0 0 1px hsl(var(--primary) / 0.2)",
					}}
					whileHover={reduced ? {} : { scale: 1.04, background: "hsl(var(--primary) / 0.15)" }}
					whileTap={reduced ? {} : { scale: 0.96 }}
					transition={{ duration: 0.15, ease: easeOutExpo }}
				>
					<FolderPlus className="w-3.5 h-3.5" />
					New
				</motion.button>
			</div>

			{/* ── Search ── */}
			<div className="px-3 pb-2">
				<motion.div
					className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 border"
					animate={
						reduced
							? {}
							: {
									borderColor: focused ? "hsl(var(--primary) / 0.5)" : "hsl(var(--border))",
									background: focused ? "hsl(var(--primary) / 0.04)" : "hsl(var(--muted) / 0.5)",
								}
					}
					transition={{ duration: 0.18, ease: easeOutExpo }}
					style={{
						borderColor: "hsl(var(--border))",
						background: "hsl(var(--muted) / 0.5)",
					}}
				>
					<Search
						className="w-3 h-3 shrink-0"
						style={{
							color: focused ? "hsl(var(--primary) / 0.7)" : "hsl(var(--muted-foreground) / 0.4)",
						}}
					/>
					<input
						ref={inputRef}
						type="text"
						placeholder="Search conversations..."
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onFocus={() => setFocused(true)}
						onBlur={() => setFocused(false)}
						className="flex-1 bg-transparent text-xs focus:outline-none"
						style={{ color: "hsl(var(--foreground))" }}
					/>
					<AnimatePresence>
						{query && (
							<motion.button
								type="button"
								aria-label="Clear search"
								onClick={() => {
									setQuery("");
									inputRef.current?.focus();
								}}
								className="shrink-0 rounded text-[10px] px-1 py-px"
								style={{
									color: "hsl(var(--muted-foreground) / 0.5)",
									background: "hsl(var(--muted))",
								}}
								initial={{ opacity: 0, scale: 0.7 }}
								animate={{ opacity: 1, scale: 1 }}
								exit={{ opacity: 0, scale: 0.7 }}
								transition={{ duration: 0.12, ease: easeOutExpo }}
							>
								✕
							</motion.button>
						)}
					</AnimatePresence>
				</motion.div>
			</div>

			{/* ── Session list ── */}
			<div className="flex-1 overflow-y-auto px-2 pb-2 space-y-px">
				{/* Empty state — AnimatePresence only here so it fades in/out */}
				<AnimatePresence>
					{filtered.length === 0 && (
						<motion.div
							key="empty"
							className="flex flex-col items-center justify-center py-12 gap-3"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
							transition={{ duration: 0.2 }}
						>
							<motion.div
								animate={reduced ? {} : { scale: [1, 1.06, 1] }}
								transition={{ duration: 2.4, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
							>
								<MessagesSquare
									className="w-7 h-7"
									style={{ color: "hsl(var(--muted-foreground) / 0.2)" }}
								/>
							</motion.div>
							<p className="text-[11px]" style={{ color: "hsl(var(--muted-foreground) / 0.4)" }}>
								{query.trim() ? "No results" : "No sessions yet"}
							</p>
						</motion.div>
					)}
				</AnimatePresence>

				{/* Rows — no AnimatePresence wrapper so filtered-out rows leave DOM
				    immediately; this keeps test assertions reliable */}
				{filtered.map((session, i) => (
					<SessionRow
						key={session.id}
						session={session}
						isActive={session.id === activeSessionId}
						index={i}
						reduced={!!reduced}
						homeDir={homeDir}
						onSelect={onSelect}
						onDelete={onDeleteSession}
					/>
				))}
			</div>
		</div>
	);
}

// ─────────────────────────────────────────────────────────────────
// SessionRow — isolated component so layoutId scopes cleanly
// ─────────────────────────────────────────────────────────────────
interface SessionRowProps {
	session: Session;
	isActive: boolean;
	index: number;
	reduced: boolean;
	homeDir?: string;
	onSelect: (id: string) => void;
	onDelete: (id: string) => void;
}

function SessionRow({
	session,
	isActive,
	index,
	reduced,
	homeDir,
	onSelect,
	onDelete,
}: SessionRowProps) {
	const [hovered, setHovered] = useState(false);
	const path = displayPath(session.folder, homeDir);

	return (
		<motion.div
			layout
			className="relative rounded-lg overflow-hidden"
			initial={reduced ? false : { opacity: 0, x: -8 }}
			animate={{ opacity: 1, x: 0 }}
			transition={{
				duration: 0.22,
				ease: [0.16, 1, 0.3, 1],
				delay: reduced ? 0 : Math.min(index * 0.035, 0.28),
			}}
			onHoverStart={() => setHovered(true)}
			onHoverEnd={() => setHovered(false)}
		>
			{/* Active accent bar */}
			<AnimatePresence>
				{isActive && (
					<motion.div
						layoutId="active-bar"
						className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full"
						style={{
							background: "hsl(var(--primary))",
							boxShadow: "0 0 10px hsl(var(--primary) / 0.7), 0 0 2px hsl(var(--primary))",
						}}
						initial={{ scaleY: 0, opacity: 0 }}
						animate={{ scaleY: 1, opacity: 1 }}
						exit={{ scaleY: 0, opacity: 0 }}
						transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
					/>
				)}
			</AnimatePresence>

			{/* Row button — bg-sidebar-accent class on active for test compat */}
			<motion.button
				type="button"
				onClick={() => onSelect(session.id)}
				className={`w-full text-left pl-4 pr-9 py-2.5 rounded-lg transition-colors ${
					isActive ? "bg-sidebar-accent" : ""
				}`}
				style={{
					background: isActive
						? "linear-gradient(90deg, hsl(var(--primary) / 0.12), hsl(var(--primary) / 0.02))"
						: hovered
							? "hsl(var(--accent) / 0.5)"
							: undefined,
				}}
				whileTap={reduced ? {} : { scale: 0.985 }}
				transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
			>
				{/* Title */}
				<span
					className={`block text-[12px] truncate leading-snug ${
						isActive ? "font-semibold" : "font-medium"
					}`}
					style={{
						color: isActive ? "hsl(var(--foreground))" : "hsl(var(--foreground) / 0.8)",
					}}
				>
					{session.title}
				</span>

				{/* Folder path — where this session was opened (VSCode-style) */}
				<span
					className="flex items-center gap-1 mt-0.5 text-[10px] truncate"
					style={{ color: "hsl(var(--muted-foreground) / 0.5)" }}
					title={session.folder || path}
				>
					<Folder className="w-2.5 h-2.5 shrink-0" />
					<span className="truncate">{path}</span>
				</span>

				{/* Last message + timestamp */}
				<span className="flex items-center gap-1.5 mt-0.5">
					<span
						className="text-[11px] truncate flex-1"
						style={{ color: "hsl(var(--muted-foreground) / 0.55)" }}
					>
						{session.lastMessage}
					</span>
					<span
						className="text-[10px] shrink-0 tabular-nums"
						style={{ color: "hsl(var(--muted-foreground) / 0.35)" }}
					>
						{formatTime(session.timestamp)}
					</span>
				</span>
			</motion.button>

			{/* Delete — slides in from right on hover */}
			<motion.button
				type="button"
				aria-label={`Delete session ${session.title}`}
				onClick={(e) => {
					e.stopPropagation();
					onDelete(session.id);
				}}
				className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center justify-center w-6 h-6 rounded-md"
				style={{ background: hovered ? "hsl(var(--muted))" : "transparent" }}
				initial={false}
				animate={
					reduced ? { opacity: hovered ? 1 : 0 } : { opacity: hovered ? 1 : 0, x: hovered ? 0 : 6 }
				}
				transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
				tabIndex={hovered ? 0 : -1}
				whileHover={{ background: "hsl(var(--destructive) / 0.12)" }}
				whileTap={reduced ? {} : { scale: 0.9 }}
			>
				<Trash2 className="w-3 h-3" style={{ color: "hsl(var(--destructive))" }} />
			</motion.button>
		</motion.div>
	);
}
