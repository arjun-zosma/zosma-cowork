import type { SessionStats, ThinkingState } from "@/lib/sessionStats";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StatusLine } from "./StatusLine";

const baseThinking: ThinkingState = {
	level: "high",
	available: ["off", "minimal", "low", "medium", "high", "xhigh"],
	supported: true,
};

const stats = (over: Partial<SessionStats> = {}): SessionStats => ({
	userMessages: 1,
	assistantMessages: 1,
	toolCalls: 0,
	toolResults: 0,
	totalMessages: 2,
	tokens: { input: 50000, output: 10000, cacheRead: 40000, cacheWrite: 5000, total: 105000 },
	cost: 0.18,
	contextUsage: { tokens: 14800, contextWindow: 200000, percent: 7.4 },
	...over,
});

describe("StatusLine", () => {
	it("renders cost, context %/window, and cache-hit rate", () => {
		render(<StatusLine stats={stats()} thinking={baseThinking} modelName="Claude Sonnet 4" />);
		expect(screen.getByText("$0.18")).toBeDefined();
		expect(screen.getByText("7.4%")).toBeDefined();
		expect(screen.getByText("/200k")).toBeDefined();
		// cache-hit = 40000 / (50000 + 40000) = 44.4%
		expect(screen.getByText("44.4%")).toBeDefined();
		// cache read / write totals
		expect(screen.getByText("r40k")).toBeDefined();
		expect(screen.getByText("w5k")).toBeDefined();
		expect(screen.getByText("Claude Sonnet 4")).toBeDefined();
	});

	it("renders the thinking level pill and cycles on click", () => {
		const onCycle = vi.fn();
		render(<StatusLine stats={stats()} thinking={baseThinking} onCycleThinking={onCycle} />);
		const pill = screen.getByRole("button", { name: /Reasoning effort: High/ });
		fireEvent.click(pill);
		expect(onCycle).toHaveBeenCalledTimes(1);
	});

	it("disables the pill when the model has no adjustable reasoning", () => {
		const onCycle = vi.fn();
		render(
			<StatusLine
				stats={stats()}
				thinking={{ level: "off", available: ["off"], supported: false }}
				onCycleThinking={onCycle}
			/>,
		);
		const pill = screen.getByRole("button", { name: /Reasoning effort: Off/ });
		expect((pill as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(pill);
		expect(onCycle).not.toHaveBeenCalled();
	});

	it("hides the pill until the engine confirms reasoning capability (known=false)", () => {
		render(
			<StatusLine stats={stats()} thinking={{ ...baseThinking, level: "medium", known: false }} />,
		);
		// No fabricated "Medium" pill should appear before the sidecar reports.
		expect(screen.queryByRole("button", { name: /Reasoning effort/ })).toBeNull();
	});

	it("shows 'No reasoning' for a model that can't reason", () => {
		render(
			<StatusLine
				stats={stats()}
				thinking={{ level: "off", available: ["off"], supported: false, known: true }}
			/>,
		);
		expect(screen.getByText("No reasoning")).toBeDefined();
	});

	it("renders the live activity indicator while running", () => {
		render(<StatusLine stats={stats()} thinking={baseThinking} isRunning status="thinking" />);
		expect(screen.getByText("Thinking")).toBeDefined();
	});

	it("shows em dashes for context % right after compaction (null usage)", () => {
		render(
			<StatusLine
				stats={stats({ contextUsage: { tokens: null, contextWindow: 200000, percent: null } })}
				thinking={baseThinking}
			/>,
		);
		// percent is "—" but the window is still shown
		expect(screen.getByText("—")).toBeDefined();
		expect(screen.getByText("/200k")).toBeDefined();
	});

	it("degrades gracefully with no stats yet", () => {
		render(<StatusLine stats={null} thinking={baseThinking} />);
		expect(screen.getByText("$0.00")).toBeDefined();
		// both context % and cache-hit are unknown → em dashes
		expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
	});
});
