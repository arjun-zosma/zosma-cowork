/**
 * BrowserViewport — the live "little screen" for Browser Session (Mode B).
 *
 * Shows the agent's persistent browser live: a floating PiP card by default
 * that morphs (shared `layoutId`) into a fullscreen panel. Frames come from
 * agent-browser's localhost stream WebSocket via useBrowserStream; session
 * lifecycle (connect / ws URL / current URL) comes from useBrowserSession.
 *
 * UX states:
 *   - hidden     — no session (status "stopped"); renders nothing.
 *   - starting   — session spinning up; PiP shows a launching shimmer.
 *   - pip        — default; ~360×232 floating card, draggable, bottom-right.
 *   - fullscreen — large panel with URL bar + (future) controls.
 *
 * Token-efficiency note: the live JPEG frames are for the HUMAN only — they
 * never go to the model, which reasons on the accessibility-tree snapshots.
 */

import { useBrowserSession } from "@/hooks/useBrowserSession";
import { useBrowserStream } from "@/hooks/useBrowserStream";
import { hostFromUrl } from "@/lib/statusLabels";
import { cn } from "@/lib/utils";
import { Globe, Loader2, Maximize2, Minimize2, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";

type ViewMode = "pip" | "fullscreen";

export interface BrowserViewportProps {
	/** Optional: called when the user closes the viewport (stops the session). */
	onStop?: () => void;
	/** Friendly label for the agent's current browser action (from tool phase). */
	actionLabel?: string;
}

export function BrowserViewport({ onStop, actionLabel }: BrowserViewportProps) {
	const session = useBrowserSession();
	const [mode, setMode] = useState<ViewMode>("pip");
	const reduce = useReducedMotion();

	const visible = session.status !== "stopped";
	// Only request frames when we have a ws URL AND the viewport is mounted/visible.
	const stream = useBrowserStream(session.streamWsUrl, visible);

	if (!visible) return null;

	const host = hostFromUrl(session.currentUrl) || "browser";
	const isStarting = session.status === "starting";
	const isError = session.status === "error";

	return (
		<AnimatePresence>
			{mode === "fullscreen" && (
				<motion.div
					key="backdrop"
					className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					onClick={() => setMode("pip")}
				/>
			)}

			<motion.div
				key="viewport"
				layoutId="browser-viewport"
				drag={mode === "pip" && !reduce}
				dragMomentum={false}
				dragElastic={0.04}
				transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 34 }}
				className={cn(
					"z-50 flex flex-col overflow-hidden rounded-xl border shadow-2xl",
					"bg-card border-border",
					mode === "pip"
						? "fixed bottom-4 right-4 w-[360px] cursor-grab active:cursor-grabbing"
						: "fixed inset-6 md:inset-10",
				)}
			>
				{/* Header / chrome bar */}
				<div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-sidebar-background select-none">
					<span className="flex items-center gap-1.5 min-w-0 flex-1">
						{isStarting || stream.connection === "connecting" ? (
							<Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-status-active-fg" />
						) : (
							<Globe
								className={cn(
									"w-3.5 h-3.5 shrink-0",
									isError ? "text-destructive" : "text-status-active-fg",
								)}
							/>
						)}
						<span className="truncate text-xs font-medium text-card-foreground">{host}</span>
						{actionLabel && (
							<span className="hidden sm:flex items-center gap-1 truncate text-[11px] text-muted-foreground">
								<span className="text-muted-foreground/50">·</span>
								<LiveDot />
								{actionLabel}
							</span>
						)}
					</span>

					<div className="flex items-center gap-0.5 shrink-0">
						<HeaderButton
							label={mode === "pip" ? "Expand" : "Minimize"}
							onClick={() => setMode(mode === "pip" ? "fullscreen" : "pip")}
						>
							{mode === "pip" ? (
								<Maximize2 className="w-3.5 h-3.5" />
							) : (
								<Minimize2 className="w-3.5 h-3.5" />
							)}
						</HeaderButton>
						{onStop && (
							<HeaderButton label="Close browser" onClick={onStop}>
								<X className="w-3.5 h-3.5" />
							</HeaderButton>
						)}
					</div>
				</div>

				{/* Live frame area */}
				<div
					className={cn(
						"relative bg-black/90 overflow-hidden",
						mode === "pip" ? "aspect-video" : "flex-1",
					)}
				>
					{stream.frameUrl ? (
						<img
							src={stream.frameUrl}
							alt="Live browser view"
							className="w-full h-full object-contain"
							draggable={false}
						/>
					) : (
						<ViewportPlaceholder isError={isError} error={session.error} />
					)}

					{/* Bottom URL strip (fullscreen only) */}
					{mode === "fullscreen" && session.currentUrl && (
						<div className="absolute bottom-0 inset-x-0 px-4 py-2 bg-gradient-to-t from-black/70 to-transparent">
							<span className="text-[11px] text-white/80 truncate block">{session.currentUrl}</span>
						</div>
					)}
				</div>
			</motion.div>
		</AnimatePresence>
	);
}

function ViewportPlaceholder({ isError, error }: { isError: boolean; error?: string }) {
	return (
		<div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
			{isError ? (
				<>
					<X className="w-6 h-6 text-destructive" />
					<p className="text-xs text-white/70 max-w-[80%]">
						{error || "Couldn't start the browser session."}
					</p>
				</>
			) : (
				<>
					<Loader2 className="w-6 h-6 text-white/50 animate-spin" />
					<p className="text-xs text-white/50">Waking up the browser…</p>
				</>
			)}
		</div>
	);
}

function HeaderButton({
	children,
	label,
	onClick,
}: {
	children: React.ReactNode;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			onClick={onClick}
			onPointerDownCapture={(e) => e.stopPropagation()}
			className="p-1.5 rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
		>
			{children}
		</button>
	);
}

/** Small pulsing dot indicating live activity. */
function LiveDot() {
	return (
		<span className="relative flex h-1.5 w-1.5">
			<span className="absolute inline-flex h-full w-full rounded-full bg-status-active-fg opacity-60 animate-ping" />
			<span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-status-active-fg" />
		</span>
	);
}
