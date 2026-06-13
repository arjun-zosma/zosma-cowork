/**
 * StatusLine — always-on footer telemetry (issue #268).
 *
 * Mirrors the pi coding-agent TUI footer in a compact, glassy strip that sits
 * just above the composer:
 *
 *   context %/window · cost · cache-hit % · r/w cache · model · thinking level
 *
 * Unlike {@link StatusBar} (a transient streaming-only "Thinking/Working"
 * indicator), this persists across turns so the numbers are always legible.
 * Each metric carries a tooltip explaining what it means, and the thinking
 * level renders as a pill that's clickable to cycle the reasoning effort.
 */

import { Tooltip } from "@/components/ui/tooltip";
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
import { BrainCircuit, Coins, Database, Gauge, Layers } from "lucide-react";

interface StatusLineProps {
	stats: SessionStats | null;
	thinking: ThinkingState;
	/** Friendly model name (matches the model selector). */
	modelName?: string;
	/** Cycle the reasoning effort (off → … → xhigh → off). */
	onCycleThinking?: () => void;
}

/** Compact `200k`-style window label. */
function windowLabel(n: number): string {
	if (n >= 1000) return `${Math.round(n / 1000)}k`;
	return `${n}`;
}

export function StatusLine({ stats, thinking, modelName, onCycleThinking }: StatusLineProps) {
	const tokens = stats?.tokens;
	const ctx = stats?.contextUsage;

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

			{/* Thinking level pill — clickable to cycle reasoning effort */}
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
					<span className="truncate">{thinkingLabel(pillLevel)}</span>
				</button>
			</Tooltip>
		</div>
	);
}

function Sep() {
	return <span className="status-line-sep" aria-hidden="true" />;
}
