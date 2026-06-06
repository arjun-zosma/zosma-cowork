import type { ToolCallInfo } from "@/types";
import { describe, expect, it } from "vitest";
import { INITIAL_STATE, type StreamAction, type StreamState, streamReducer } from "./usePiStream";

function run(actions: StreamAction[], start: StreamState = INITIAL_STATE): StreamState {
	return actions.reduce(streamReducer, start);
}

const tool = (id: string, name: string): ToolCallInfo => ({
	id,
	name,
	args: {},
	status: "running",
});

describe("streamReducer — single bubble per agent run", () => {
	it("clubs a multi-step run (think→tool→think→answer) into ONE assistant message", () => {
		const state = run([
			{ type: "START_STREAM", prompt: "What projects I have?" },
			// sub-turn 1: think + a tool
			{ type: "TURN_RESET" },
			{ type: "THINKING_DELTA", delta: "Let me check memex memory." },
			{ type: "TOOL_CALL_START", toolCall: tool("t1", "memex_recall") },
			{
				type: "TOOL_CALL_UPDATE",
				id: "t1",
				result: "ok",
				status: "completed",
			},
			{ type: "MESSAGE_END" },
			// sub-turn 2: think + more tools
			{ type: "TURN_RESET" },
			{ type: "THINKING_DELTA", delta: "Now look at the filesystem." },
			{ type: "TOOL_CALL_START", toolCall: tool("t2", "ls") },
			{ type: "TOOL_CALL_UPDATE", id: "t2", result: "ok", status: "completed" },
			{ type: "MESSAGE_END" },
			// sub-turn 3: final answer text
			{ type: "TURN_RESET" },
			{ type: "TEXT_DELTA", delta: "Here are your projects." },
			{ type: "MESSAGE_END" },
			{ type: "STREAM_COMPLETE" },
		]);

		// 1 user + exactly 1 assistant bubble (not 3+)
		expect(state.messages).toHaveLength(2);
		const assistant = state.messages[1];
		expect(assistant.role).toBe("assistant");
		// all tool calls from every sub-turn accumulate in the single bubble
		expect(assistant.toolCalls?.map((t) => t.id)).toEqual(["t1", "t2"]);
		// final answer text preserved
		expect(assistant.content).toContain("Here are your projects.");
		// both reasoning snippets retained; latest is last
		expect(assistant.thinking).toContain("Let me check memex memory.");
		expect(assistant.thinking).toContain("Now look at the filesystem.");
		expect(state.streamingMessage).toBeNull();
		expect(state.isRunning).toBe(false);
	});

	it("MESSAGE_END does not split the bubble or drop tools", () => {
		const mid = run([
			{ type: "START_STREAM", prompt: "x" },
			{ type: "TOOL_CALL_START", toolCall: tool("t1", "read") },
			{ type: "MESSAGE_END" },
		]);
		// still streaming a single bubble, tool retained, nothing finalized yet
		expect(mid.messages).toHaveLength(1); // just the user message
		expect(mid.streamingMessage?.toolCalls).toHaveLength(1);
	});

	it("TURN_RESET keeps tools and separates successive thinking", () => {
		const s = run([
			{ type: "START_STREAM", prompt: "x" },
			{ type: "THINKING_DELTA", delta: "first" },
			{ type: "TOOL_CALL_START", toolCall: tool("t1", "read") },
			{ type: "TURN_RESET" },
			{ type: "THINKING_DELTA", delta: "second" },
		]);
		expect(s.streamingMessage?.toolCalls).toHaveLength(1);
		expect(s.streamingMessage?.thinking).toBe("first\nsecond");
	});
});
