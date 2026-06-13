/**
 * StatusLine — always-on footer telemetry + live activity (issue #268).
 *
 * Mirrors the pi coding-agent TUI footer in a compact, glassy strip that sits
 * just above the composer:
 *
 *   [● Thinking · 5s] · context %/window · ↑in ↓out · cost · cache-hit % · r/w · model · thinking level
 *
 * While the agent is responding it ALSO hosts the transient "Thinking/Working"
 * indicator (spinner + friendly phase label + elapsed timer) on the left — this
 * replaces the old standalone StatusBar so there's a single footer. The Stop
 * action now lives inside the composer. Each metric carries a tooltip, and the
 * thinking level renders as a pill that's clickable to cycle reasoning effort.
 */

import { Tooltip } from "@/components/ui/tooltip";
import type { ToolPhase } from "@/hooks/usePiStream";
import {
	type SessionStats,
	type ThinkingState,
	cacheHitRate,
	formatCost,
	formatPercent,
	formatRatio,
	formatTokens,
	thinkingLabel,
} from "@/lib/sessionStats";
import { friendlyToolPhrase } from "@/lib/statusLabels";
import type { ChatMessage } from "@/types";
import {
	ArrowDown,
	ArrowUp,
	BrainCircuit,
	Coins,
	Database,
	Gauge,
	Layers,
	Loader2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

type StreamStateStatus = "idle" | "thinking" | "tool_call" | "responding" | "error";

interface StatusLineProps {
	stats: SessionStats | null;
	thinking: ThinkingState;
	/** Friendly model name (matches the model selector). */
	modelName?: string;
	/** Cycle the reasoning effort (off → … → xhigh → off). */
	onCycleThinking?: () => void;
	/** True while the agent is actively responding (drives the live indicator). */
	isRunning?: boolean;
	/** Coarse stream phase used to pick the friendly activity label. */
	status?: StreamStateStatus;
	/** In-flight assistant message (for tool-progress dots). */
	streamingMessage?: ChatMessage | null;
	/** Fine-grained tool phase for a more specific activity label. */
	toolPhase?: ToolPhase | null;
}

/** Compact `200k`-style window label. */
function windowLabel(n: number): string {
	if (n >= 1000) return `${Math.round(n / 1000)}k`;
	return `${n}`;
}

function formatElapsed(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${m}m ${s.toString().padStart(2, "0")}s`;
}

/** Friendly, non-technical activity label (issue #173) — no raw commands/paths. */
function activityLabel(
	status: StreamStateStatus | undefined,
	toolPhase: ToolPhase | null | undefined,
	toolCalls: ChatMessage["toolCalls"],
): string {
	if (status === "thinking") return "Thinking";
	if (status === "responding") return "Writing a response";
	if (status === "error") return "Something went wrong";
	if (status === "tool_call") {
		if (toolPhase) {
			switch (toolPhase.type) {
				case "calling":
				case "executing":
					return friendlyToolPhrase(toolPhase.toolName);
				case "done":
					return "Working";
				case "error":
					return "Something went wrong";
			}
		}
		const running = (toolCalls || []).find((tc) => tc.status === "running");
		return running ? friendlyToolPhrase(running.name) : "Working";
	}
	return status ?? "Working";
}

export function StatusLine({
	stats,
	thinking,
	modelName,
	onCycleThinking,
	isRunning,
	status,
	streamingMessage,
	toolPhase,
}: StatusLineProps) {
	const tokens = stats?.tokens;
	const ctx = stats?.contextUsage;

	// Elapsed-time counter for the live activity indicator — resets per run.
	const [elapsed, setElapsed] = useState(0);
	const startTimeRef = useRef<number | null>(null);
	useEffect(() => {
		if (!isRunning) {
			setElapsed(0);
			startTimeRef.current = null;
			return;
		}
		if (startTimeRef.current === null) startTimeRef.current = Date.now();
		const tick = () => {
			if (startTimeRef.current !== null) {
				setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
			}
		};
		tick();
		const id = setInterval(tick, 1000);
		return () => clearInterval(id);
	}, [isRunning]);

	const toolCalls = streamingMessage?.toolCalls || [];

	// Cache-hit rate: prefer the live totals; null when there's no input yet.
	const hit = tokens ? cacheHitRate(tokens.input, tokens.cacheRead) : null;

	// Context: percent may be null right after compaction (docs/rpc.md) — show
	// "—" rather than a misleading 0%.
	const ctxPercent = ctx ? formatPercent(ctx.percent) : "—";
	const ctxWindow = ctx ? windowLabel(ctx.contextWindow) : null;

	const pillLevel = thinking.level;
	const reasoningDisabled = !thinking.supported || thinking.available.length <= 1;

	return (
		<div
			className="status-line flex items-center gap-1 px-4 py-1.5 mx-auto w-full overflow-x-auto"
			style={{ maxWidth: "var(--chat-composer-max-width, 852px)" }}
			aria-label="Session telemetry"
		>
			{/* Live activity indicator (replaces the old StatusBar). Only while the
			    agent is responding: spinner + friendly phase label + tool-progress
			    dots + elapsed timer. The Stop action lives in the composer. */}
			{isRunning && (
				<>
					<div className="status-activity" aria-label="Agent activity">
						<Loader2 className="status-activity-spinner animate-spin" />
						<span className="status-activity-label">
							{activityLabel(status, toolPhase, toolCalls)}
						</span>
						{toolCalls.length > 0 && (
							<span className="flex items-center gap-1 shrink-0">
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
							</span>
						)}
						<span className="status-activity-elapsed">{formatElapsed(elapsed)}</span>
					</div>
					<Sep />
				</>
			)}

			{/* Context window usage */}
			<Tooltip
				side="top"
				content={
					ctx
						? `Context window: ${ctxPercent} of ${ctxWindow} tokens in use. Drives auto-compaction.`
						: "Context window usage — available once the model responds."
				}
			>
				<div className="status-metric">
					<Gauge className="status-metric-icon" />
					<span className="status-metric-value">{ctxPercent}</span>
					{ctxWindow && <span className="status-metric-unit">/{ctxWindow}</span>}
				</div>
			</Tooltip>

			<Sep />

			{/* Input / output tokens (↑ sent · ↓ generated) — matches pi's footer. */}
			<Tooltip
				side="top"
				content="Tokens this session — ↑ input (prompt tokens sent) · ↓ output (tokens generated by the model)."
			>
				<div className="status-metric">
					<ArrowUp className="status-metric-icon" />
					<span className="status-metric-value">{tokens ? formatTokens(tokens.input) : "0"}</span>
					<ArrowDown className="status-metric-icon" />
					<span className="status-metric-value">{tokens ? formatTokens(tokens.output) : "0"}</span>
				</div>
			</Tooltip>

			<Sep />

			{/* Cumulative cost */}
			<Tooltip side="top" content="Cumulative session cost (USD) across all turns.">
				<div className="status-metric">
					<Coins className="status-metric-icon" />
					<span className="status-metric-value">{stats ? formatCost(stats.cost) : "$0.00"}</span>
				</div>
			</Tooltip>

			<Sep />

			{/* Cache-hit rate */}
			<Tooltip
				side="top"
				content="Cache-hit rate — share of input tokens served from the prompt cache (cacheRead ÷ (input + cacheRead)). Higher = cheaper & faster."
			>
				<div className="status-metric">
					<Database className="status-metric-icon" />
					<span className="status-metric-label">CH</span>
					<span className="status-metric-value">{formatRatio(hit)}</span>
				</div>
			</Tooltip>

			<Sep />

			{/* Cache read / write totals */}
			<Tooltip
				side="top"
				content="Cache read / write — tokens read from cache (r, cheap) and written into cache (w, one-time premium)."
			>
				<div className="status-metric">
					<Layers className="status-metric-icon" />
					<span className="status-metric-value">
						r{tokens ? formatTokens(tokens.cacheRead) : "0"}
					</span>
					<span className="status-metric-unit">
						w{tokens ? formatTokens(tokens.cacheWrite) : "0"}
					</span>
				</div>
			</Tooltip>

			{/* Model — pushed to the right with thinking pill */}
			<div className="flex-1" />

			{modelName && (
				<Tooltip side="top" content="Active model answering this session.">
					<span className="status-metric-model">{modelName}</span>
				</Tooltip>
			)}

			{/* Thinking level pill — clickable to cycle reasoning effort. Hidden
			    until the sidecar confirms the model's real capability (known), so
			    we never flash a fabricated "Medium" for a non-reasoning model. */}
			{thinking.known !== false && (
				<Tooltip
					side="top"
					content={
						reasoningDisabled
							? "This model doesn't expose adjustable reasoning."
							: `Reasoning effort: ${thinkingLabel(pillLevel)}. Click to cycle (off · minimal · low · medium · high · xhigh).`
					}
				>
					<button
						type="button"
						onClick={reasoningDisabled ? undefined : onCycleThinking}
						disabled={reasoningDisabled}
						aria-label={`Reasoning effort: ${thinkingLabel(pillLevel)}${reasoningDisabled ? "" : ". Click to cycle."}`}
						className="status-thinking-pill"
						data-level={pillLevel}
					>
						<BrainCircuit className="w-3 h-3 shrink-0" />
						<span className="truncate">
							{!thinking.supported ? "No reasoning" : thinkingLabel(pillLevel)}
						</span>
					</button>
				</Tooltip>
			)}
		</div>
	);
}

function Sep() {
	return <span className="status-line-sep" aria-hidden="true" />;
}
