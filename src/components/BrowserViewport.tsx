/**
 * BrowserViewport — the live "little screen" for Browser Session (Mode B).
 *
 * Shows the agent's persistent browser live: a floating PiP card by default
 * that morphs (shared `layoutId`) into a fullscreen panel. Frames come from
 * agent-browser's localhost stream WebSocket via useBrowserStream; session
 * lifecycle (connect / ws URL / current URL) comes from useBrowserSession.
 *
 * TAKE CONTROL: the user can grab the wheel — pointer clicks, scroll, and
 * keystrokes on the live frame are translated into viewport coordinates and
 * forwarded to the managed browser via the `browser_input` Tauri command
 * (→ sidecar → agent-browser CDP input). This is how a human logs in / solves
 * a CAPTCHA inside the app, then hands control back to the agent. Because the
 * managed profile persists, you only log into a site once.
 *
 * UX states:
 *   - hidden     — no session (status "stopped"); renders nothing.
 *   - starting   — session spinning up; PiP shows a launching shimmer.
 *   - pip        — default; ~360px floating card, draggable, bottom-right.
 *   - fullscreen — large panel with URL bar + controls.
 *
 * Token-efficiency note: the live JPEG frames are for the HUMAN only — they
 * never go to the model, which reasons on the accessibility-tree snapshots.
 */

import { useBrowserSession } from "@/hooks/useBrowserSession";
import { useBrowserStream } from "@/hooks/useBrowserStream";
import { hostFromUrl } from "@/lib/statusLabels";
import { cn } from "@/lib/utils";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Globe, Hand, Loader2, Maximize2, Minimize2, MousePointer2, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useRef, useState } from "react";

type ViewMode = "pip" | "fullscreen";

export interface BrowserViewportProps {
	/** Optional: called when the user closes the viewport (stops the session). */
	onStop?: () => void;
	/** Friendly label for the agent's current browser action (from tool phase). */
	actionLabel?: string;
}

/** Special keys forwarded as a `press` (everything else types as text). */
const SPECIAL_KEYS = new Set([
	"Enter",
	"Tab",
	"Backspace",
	"Delete",
	"Escape",
	"ArrowUp",
	"ArrowDown",
	"ArrowLeft",
	"ArrowRight",
	"Home",
	"End",
	"PageUp",
	"PageDown",
]);

async function sendInput(args: Record<string, unknown>): Promise<void> {
	if (!isTauri()) return;
	try {
		await invoke("browser_input", args);
	} catch {
		/* surfaced elsewhere; keep input responsive */
	}
}

export function BrowserViewport({ onStop, actionLabel }: BrowserViewportProps) {
	const session = useBrowserSession();
	const [mode, setMode] = useState<ViewMode>("pip");
	const [controlling, setControlling] = useState(false);
	const reduce = useReducedMotion();
	const frameRef = useRef<HTMLDivElement | null>(null);

	const visible = session.status !== "stopped";
	// Only request frames when we have a ws URL AND the viewport is mounted/visible.
	const stream = useBrowserStream(session.streamWsUrl, visible);

	/** Map a container-relative point to viewport pixels (accounts for object-contain letterboxing). */
	const toViewport = useCallback(
		(clientX: number, clientY: number): { x: number; y: number } | null => {
			const el = frameRef.current;
			if (!el) return null;
			const rect = el.getBoundingClientRect();
			const vw = stream.viewportWidth || 1280;
			const vh = stream.viewportHeight || 720;
			const scale = Math.min(rect.width / vw, rect.height / vh);
			const dw = vw * scale;
			const dh = vh * scale;
			const ox = (rect.width - dw) / 2;
			const oy = (rect.height - dh) / 2;
			const x = (clientX - rect.left - ox) / scale;
			const y = (clientY - rect.top - oy) / scale;
			if (x < 0 || y < 0 || x > vw || y > vh) return null; // click in letterbox
			return { x, y };
		},
		[stream.viewportWidth, stream.viewportHeight],
	);

	const toggleControl = useCallback(() => {
		setControlling((c) => {
			const next = !c;
			if (next) setMode("fullscreen"); // controlling is far easier at full size
			return next;
		});
	}, []);

	const onFramePointerDown = useCallback(
		(e: React.PointerEvent) => {
			if (!controlling) return;
			e.preventDefault();
			frameRef.current?.focus();
			const pt = toViewport(e.clientX, e.clientY);
			if (pt) void sendInput({ action: "click", x: pt.x, y: pt.y });
		},
		[controlling, toViewport],
	);

	const onFrameWheel = useCallback(
		(e: React.WheelEvent) => {
			if (!controlling) return;
			void sendInput({ action: "wheel", dy: e.deltaY, dx: e.deltaX });
		},
		[controlling],
	);

	const onFrameKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (!controlling) return;
			const { key, ctrlKey, metaKey, altKey } = e;
			// Modifier combos → press "Control+x" style.
			if ((ctrlKey || metaKey || altKey) && key.length === 1) {
				e.preventDefault();
				const mods = [ctrlKey && "Control", metaKey && "Meta", altKey && "Alt"].filter(Boolean);
				void sendInput({ action: "press", key: `${mods.join("+")}+${key}` });
				return;
			}
			if (SPECIAL_KEYS.has(key)) {
				e.preventDefault();
				void sendInput({ action: "press", key });
				return;
			}
			if (key.length === 1) {
				e.preventDefault();
				void sendInput({ action: "type", text: key });
			}
		},
		[controlling],
	);

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
					onClick={() => !controlling && setMode("pip")}
				/>
			)}

			<motion.div
				key="viewport"
				layoutId="browser-viewport"
				drag={mode === "pip" && !controlling && !reduce}
				dragMomentum={false}
				dragElastic={0.04}
				transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 34 }}
				className={cn(
					"z-50 flex flex-col overflow-hidden rounded-xl border shadow-2xl bg-card",
					controlling ? "border-status-active-fg ring-2 ring-status-active-fg/40" : "border-border",
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
						{actionLabel && !controlling && (
							<span className="hidden sm:flex items-center gap-1 truncate text-[11px] text-muted-foreground">
								<span className="text-muted-foreground/50">·</span>
								<LiveDot />
								{actionLabel}
							</span>
						)}
					</span>

					<div className="flex items-center gap-0.5 shrink-0">
						{/* Take Control toggle — only meaningful once frames are flowing. */}
						{stream.frameUrl && (
							<button
								type="button"
								onClick={toggleControl}
								onPointerDownCapture={(e) => e.stopPropagation()}
								className={cn(
									"flex items-center gap-1 px-2 py-1 mr-0.5 rounded-md text-[11px] font-medium transition-colors",
									controlling
										? "bg-status-active-fg/15 text-status-active-fg hover:bg-status-active-fg/25"
										: "text-muted-foreground hover:bg-accent hover:text-foreground",
								)}
								title={
									controlling ? "Hand control back to the agent" : "Take control of the browser"
								}
							>
								{controlling ? (
									<>
										<MousePointer2 className="w-3.5 h-3.5" /> Done
									</>
								) : (
									<>
										<Hand className="w-3.5 h-3.5" /> Take control
									</>
								)}
							</button>
						)}
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
					ref={frameRef}
					tabIndex={controlling ? 0 : -1}
					onPointerDown={onFramePointerDown}
					onWheel={onFrameWheel}
					onKeyDown={onFrameKeyDown}
					className={cn(
						"relative bg-black/90 overflow-hidden outline-none",
						mode === "pip" ? "aspect-video" : "flex-1",
						controlling && "cursor-default",
					)}
				>
					{stream.frameUrl ? (
						<img
							src={stream.frameUrl}
							alt="Live browser view"
							className="w-full h-full object-contain pointer-events-none"
							draggable={false}
						/>
					) : (
						<ViewportPlaceholder isError={isError} error={session.error} />
					)}

					{/* Control-active banner */}
					{controlling && (
						<div className="absolute top-0 inset-x-0 px-3 py-1.5 bg-status-active-fg/90 text-[11px] font-medium text-white flex items-center gap-1.5 justify-center">
							<MousePointer2 className="w-3 h-3" />
							You're controlling the browser — click & type directly. Press “Done” to hand back.
						</div>
					)}

					{/* Bottom URL strip (fullscreen only) */}
					{mode === "fullscreen" && session.currentUrl && !controlling && (
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
