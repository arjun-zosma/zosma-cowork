/**
 * StatusBar — Premium real-time status shown during streaming.
 *
 * Features:
 *   - Elapsed time counter
 *   - Current state label with tool-specific detail (bash $ cmd, read /path, etc.)
 *   - Tool call progress (n/total) with colored indicators
 *   - Animated status dot
 *   - Abort button
 */

import type { ToolPhase } from "@/hooks/usePiStream";
import { friendlyToolPhrase } from "@/lib/statusLabels";
import type { ChatMessage } from "@/types";
import { Loader2, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type StreamStateStatus = "idle" | "thinking" | "tool_call" | "responding" | "error";

interface StatusBarProps {
	isRunning: boolean;
	status: StreamStateStatus;
	streamingMessage: ChatMessage | null;
	toolPhase?: ToolPhase | null;
	onAbort: () => void;
}

export function StatusBar({
	isRunning,
	status,
	streamingMessage,
	toolPhase,
	onAbort,
}: StatusBarProps) {
	const [elapsed, setElapsed] = useState(0);
	const startTimeRef = useRef<number | null>(null);

	// Elapsed time counter — reset start time on each stream start
	useEffect(() => {
		if (!isRunning) {
			setElapsed(0);
			startTimeRef.current = null;
			return;
		}
		if (startTimeRef.current === null) {
			startTimeRef.current = Date.now();
		}
		const tick = () => {
			if (startTimeRef.current !== null) {
				setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
			}
		};
		tick();
		const id = setInterval(tick, 1000);
		return () => clearInterval(id);
	}, [isRunning]);

	if (!isRunning) return null;

	const toolCalls = streamingMessage?.toolCalls || [];
	const completedTools = toolCalls.filter(
		(tc) => tc.status === "completed" || tc.status === "error",
	).length;
	const totalTools = toolCalls.length;

	// Friendly, non-technical status label (issue #173). We deliberately do NOT
	// surface raw commands, paths, partial output, or model ids here.
	let statusLabel: string;

	if (status === "thinking") {
		statusLabel = "Thinking";
	} else if (status === "tool_call") {
		if (toolPhase) {
			switch (toolPhase.type) {
				case "calling":
				case "executing":
					statusLabel = friendlyToolPhrase(toolPhase.toolName);
					break;
				case "done":
					statusLabel = "Working";
					break;
				case "error":
					statusLabel = "Something went wrong";
					break;
			}
		} else {
			const runningTool = toolCalls.find((tc) => tc.status === "running");
			statusLabel = runningTool ? friendlyToolPhrase(runningTool.name) : "Working";
		}
	} else if (status === "responding") {
		statusLabel = "Writing a response";
	} else if (status === "error") {
		statusLabel = "Something went wrong";
	} else {
		statusLabel = status;
	}

	return (
		<div
			className="flex items-center justify-between px-4 py-2 border-t animate-fade-in"
			style={{
				background: "hsl(var(--status-bg))",
				borderColor: "hsl(var(--status-divider))",
			}}
		>
			<div className="flex items-center gap-2.5 min-w-0">
				{/* Spin icon */}
				<Loader2
					className="w-3.5 h-3.5 animate-spin flex-shrink-0"
					style={{ color: "hsl(var(--status-active-fg))" }}
				/>

				{/* Primary status label */}
				<span
					className="text-xs font-medium flex-shrink-0"
					style={{ color: "hsl(var(--status-active-fg))" }}
				>
					{statusLabel}
				</span>

				{/* Tool progress dots */}
				{totalTools > 0 && (
					<span className="flex items-center gap-1 flex-shrink-0">
						{toolCalls.map((tc) => (
							<span
								key={tc.id}
								className="inline-block w-1.5 h-1.5 rounded-full"
								style={{
									background:
										tc.status === "running"
											? "hsl(var(--tool-running-fg))"
											: tc.status === "error"
												? "hsl(var(--tool-error-fg))"
												: "hsl(var(--tool-complete-fg))",
									animation:
										tc.status === "running" ? "pulse-dot 1.5s ease-in-out infinite" : undefined,
								}}
							/>
						))}
						<span className="text-[10px] text-muted-foreground ml-0.5 tabular-nums">
							{completedTools}/{totalTools}
						</span>
					</span>
				)}

				{/* Separator */}
				<span className="text-muted-foreground/30 flex-shrink-0">·</span>

				{/* Elapsed time */}
				<span className="text-[10px] text-muted-foreground/60 tabular-nums font-mono flex-shrink-0">
					{formatElapsed(elapsed)}
				</span>
			</div>

			{/* Abort button */}
			<button
				type="button"
				onClick={onAbort}
				className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0"
			>
				<Square className="w-3 h-3 fill-current" />
				Stop
			</button>
		</div>
	);
}

function formatElapsed(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${m}m ${s.toString().padStart(2, "0")}s`;
}
