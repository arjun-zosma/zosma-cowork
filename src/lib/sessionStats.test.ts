import { describe, expect, it } from "vitest";
import {
	type MessageUsage,
	THINKING_LEVELS,
	aggregateUsage,
	cacheHitRate,
	formatCost,
	formatPercent,
	formatRatio,
	formatTokens,
	nextThinkingLevel,
	thinkingLabel,
} from "./sessionStats";

const usage = (over: Partial<MessageUsage> = {}): MessageUsage => ({
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	cost: { total: 0 },
	...over,
});

describe("aggregateUsage", () => {
	it("sums input/output/cache/cost across messages", () => {
		const totals = aggregateUsage([
			usage({ input: 100, output: 20, cacheRead: 40, cacheWrite: 5, cost: { total: 0.1 } }),
			usage({ input: 50, output: 10, cacheRead: 60, cacheWrite: 0, cost: { total: 0.08 } }),
		]);
		expect(totals.input).toBe(150);
		expect(totals.output).toBe(30);
		expect(totals.cacheRead).toBe(100);
		expect(totals.cacheWrite).toBe(5);
		expect(totals.totalTokens).toBe(150 + 30 + 100 + 5);
		expect(totals.cost).toBeCloseTo(0.18, 5);
	});

	it("treats missing/partial cost objects as zero (no NaN)", () => {
		const totals = aggregateUsage([
			usage({ input: 10, cost: null }),
			{ input: 5, output: 0, cacheRead: 0, cacheWrite: 0 } as MessageUsage,
			usage({ input: 5, cost: {} }),
		]);
		expect(totals.input).toBe(20);
		expect(totals.cost).toBe(0);
		expect(Number.isNaN(totals.cost)).toBe(false);
	});

	it("returns zeros for an empty session", () => {
		const totals = aggregateUsage([]);
		expect(totals).toEqual({
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: 0,
		});
	});
});

describe("cacheHitRate", () => {
	it("computes cacheRead / (input + cacheRead)", () => {
		// 40000 cacheRead, 50000 input → 40000/90000 ≈ 0.4444
		expect(cacheHitRate(50000, 40000)).toBeCloseTo(0.4444, 4);
	});

	it("is 1 when everything is cached", () => {
		expect(cacheHitRate(0, 1000)).toBe(1);
	});

	it("returns null when there is no input yet (avoids 0/0)", () => {
		expect(cacheHitRate(0, 0)).toBeNull();
	});
});

describe("nextThinkingLevel", () => {
	it("advances through the full ladder and wraps", () => {
		expect(nextThinkingLevel("off")).toBe("minimal");
		expect(nextThinkingLevel("medium")).toBe("high");
		expect(nextThinkingLevel("xhigh")).toBe("off");
	});

	it("wraps within a model-restricted subset", () => {
		const avail = ["off", "low", "high"] as const;
		expect(nextThinkingLevel("off", avail)).toBe("low");
		expect(nextThinkingLevel("high", avail)).toBe("off");
	});

	it("falls back to first available when current is unsupported", () => {
		const avail = ["low", "medium"] as const;
		expect(nextThinkingLevel("xhigh", avail)).toBe("low");
	});

	it("round-trips a full cycle back to the start", () => {
		let level: (typeof THINKING_LEVELS)[number] = "off";
		for (let i = 0; i < THINKING_LEVELS.length; i++) {
			level = nextThinkingLevel(level);
		}
		expect(level).toBe("off");
	});
});

describe("formatters", () => {
	it("formatTokens", () => {
		expect(formatTokens(940)).toBe("940");
		expect(formatTokens(125000)).toBe("125k");
		expect(formatTokens(1_250_000)).toBe("1.3M");
		expect(formatTokens(0)).toBe("0");
		expect(formatTokens(-5)).toBe("0");
	});

	it("formatCost", () => {
		expect(formatCost(0.18)).toBe("$0.18");
		expect(formatCost(0)).toBe("$0.00");
		expect(formatCost(12.5)).toBe("$12.50");
	});

	it("formatPercent / formatRatio handle null gracefully", () => {
		expect(formatPercent(7.43)).toBe("7.4%");
		expect(formatPercent(null)).toBe("—");
		expect(formatRatio(0.987)).toBe("98.7%");
		expect(formatRatio(null)).toBe("—");
	});

	it("thinkingLabel", () => {
		expect(thinkingLabel("high")).toBe("High");
		expect(thinkingLabel("xhigh")).toBe("Extra high");
		expect(thinkingLabel("off")).toBe("Off");
	});
});
