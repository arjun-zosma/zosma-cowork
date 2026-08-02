import { afterEach, describe, expect, it, vi } from "vitest";
import { handleStartOAuth } from "./auth.js";

const send = vi.hoisted(() => vi.fn());
vi.mock("../../protocol.js", () => ({
	send,
	log: vi.fn(),
}));

function makeDeps(login: (provider: string, callbacks: any) => Promise<void>) {
	return {
		initialized: true,
		authStorage: { login },
		modelRegistry: { refresh: vi.fn() },
		oauthAbort: null,
		setOauthAbort: vi.fn(),
		setOauthInflight: vi.fn(),
	} as any;
}

afterEach(() => {
	send.mockReset();
});

describe("handleStartOAuth", () => {
	it("returns success and forwards browser/device OAuth events", async () => {
		const deps = makeDeps(async (_provider, callbacks) => {
			callbacks.onAuth({ url: "https://auth.example.test/authorize", instructions: "Continue in browser." });
			callbacks.onDeviceCode({ userCode: "ABCD-1234", verificationUri: "https://github.com/login/device" });
			callbacks.onProgress("Waiting for authorization");
		});

		await handleStartOAuth(deps, { id: "oauth-1", type: "start_oauth", provider: "anthropic" });
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(send).toHaveBeenCalledWith({
			type: "result",
			id: "oauth-1",
			data: { success: true, started: true, provider: "anthropic" },
		});
		expect(send.mock.calls.map(([call]) => call)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ event: expect.objectContaining({ kind: "oauth_open_url" }) }),
				expect.objectContaining({ event: expect.objectContaining({ kind: "oauth_progress" }) }),
				expect.objectContaining({ event: expect.objectContaining({ kind: "oauth_completed" }) }),
			]),
		);
	});

	it("forwards provider failures through the frontend event contract", async () => {
		const deps = makeDeps(async () => {
			throw new Error("provider login failed");
		});

		await handleStartOAuth(deps, { id: "oauth-2", type: "start_oauth", provider: "openai-codex" });
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(send).toHaveBeenCalledWith({
			type: "event",
			event: { kind: "oauth_failed", provider: "openai-codex", error: "provider login failed" },
		});
	});
});
