/**
 * Session telemetry helpers — issue #268.
 *
 * Pure, side-effect-free utilities for the always-on status line that mirrors
 * the pi coding-agent TUI footer:
 *
 *   context %/window · cost · cache-hit % · r/w cache · model · thinking level
 *
 * The authoritative numbers come from the sidecar's `get_session_stats`
 * command (which wraps the SDK's `AgentSession.getSessionStats()`), but the
 * aggregation + formatting math lives here so it is unit-testable in isolation
 * and reusable as a client-side fallback when `get_session_stats` is
 * unavailable (e.g. remote/browser mode).
 */

/** Reasoning effort levels, ordered cheapest → most thorough (pi's ladder). */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** Per-message token usage (subset of pi's `Usage`). */
export interface MessageUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost?: { total?: number } | null;
}

/** Aggregated token + cost totals for a session. */
export interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** input + output + cacheRead + cacheWrite. */
	totalTokens: number;
	/** Cumulative USD cost across all priced messages. */
	cost: number;
}

/** Live context-window estimate (matches `get_session_stats.contextUsage`). */
export interface ContextUsage {
	/** Estimated tokens currently occupying context, or null post-compaction. */
	tokens: number | null;
	/** The active model's context window, e.g. 200000. */
	contextWindow: number;
	/** tokens / contextWindow * 100, or null when `tokens` is null. */
	percent: number | null;
}

/** Shape returned by the sidecar `get_session_stats` command (#268). */
export interface SessionStats {
	sessionFile?: string;
	sessionId?: string;
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	toolResults: number;
	totalMessages: number;
	tokens: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
	cost: number;
	contextUsage?: ContextUsage;
	thinkingLevel?: ThinkingLevel;
	availableThinkingLevels?: ThinkingLevel[];
	supportsThinking?: boolean;
}

/** Thinking-level slice tracked by the UI. */
export interface ThinkingState {
	level: ThinkingLevel;
	available: ThinkingLevel[];
	supported: boolean;
	/**
	 * Whether the sidecar has reported the real reasoning capability yet.
	 * `false` on first paint (before the engine answers) so the UI can avoid
	 * showing a fabricated default level (e.g. "Medium") for a model that may
	 * not support reasoning at all. Undefined is treated as known (test
	 * fixtures / remote mode).
	 */
	known?: boolean;
}

/**
 * Sum per-message usage into session totals. Tolerates missing/partial cost
 * objects (treats them as 0) so a streaming message without a finalized cost
 * doesn't NaN the running total.
 */
export function aggregateUsage(usages: readonly MessageUsage[]): UsageTotals {
	let input = 0;
	let output = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	let cost = 0;
	for (const u of usages) {
		input += u.input || 0;
		output += u.output || 0;
		cacheRead += u.cacheRead || 0;
		cacheWrite += u.cacheWrite || 0;
		cost += u.cost?.total || 0;
	}
	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens: input + output + cacheRead + cacheWrite,
		cost,
	};
}

/**
 * Cache-hit rate = cacheRead / (input + cacheRead) — the fraction of input
 * tokens served from the provider prompt cache rather than re-billed at full
 * price. Returns `null` when there's no input yet (avoids 0/0 → NaN), which
 * the UI renders as "—".
 */
export function cacheHitRate(input: number, cacheRead: number): number | null {
	const denom = input + cacheRead;
	if (denom <= 0) return null;
	return cacheRead / denom;
}

/**
 * Next thinking level when cycling. Wraps around the *available* ladder (the
 * model-supported subset), matching the SDK's `cycleThinkingLevel`. If the
 * current level isn't in `available` (e.g. just switched models), starts from
 * the first available level.
 */
export function nextThinkingLevel(
	current: ThinkingLevel,
	available: readonly ThinkingLevel[] = THINKING_LEVELS,
): ThinkingLevel {
	if (available.length === 0) return current;
	const idx = available.indexOf(current);
	if (idx === -1) return available[0];
	return available[(idx + 1) % available.length];
}

/** Compact token count: 125000 → "125k", 1_250_000 → "1.3M", 940 → "940". */
export function formatTokens(n: number): string {
	if (!Number.isFinite(n) || n < 0) return "0";
	if (n >= 1_000_000) {
		const m = n / 1_000_000;
		return `${m >= 10 ? Math.round(m) : m.toFixed(1)}M`;
	}
	if (n >= 1000) return `${Math.round(n / 1000)}k`;
	return `${Math.round(n)}`;
}

/** Cost in USD: 0.18 → "$0.18", 0 → "$0.00", 12.5 → "$12.50". */
export function formatCost(usd: number): string {
	const safe = Number.isFinite(usd) && usd > 0 ? usd : 0;
	return `$${safe.toFixed(2)}`;
}

/** Percentage with one decimal: 7.43 → "7.4%". Null/undefined → "—". */
export function formatPercent(p: number | null | undefined): string {
	if (p === null || p === undefined || !Number.isFinite(p)) return "—";
	return `${p.toFixed(1)}%`;
}

/** Ratio (0..1) → percent string with one decimal: 0.987 → "98.7%". */
export function formatRatio(r: number | null | undefined): string {
	if (r === null || r === undefined || !Number.isFinite(r)) return "—";
	return `${(r * 100).toFixed(1)}%`;
}

/** Title-case label for a thinking level, e.g. "xhigh" → "Extra high". */
export function thinkingLabel(level: ThinkingLevel): string {
	if (level === "xhigh") return "Extra high";
	return level.charAt(0).toUpperCase() + level.slice(1);
}
