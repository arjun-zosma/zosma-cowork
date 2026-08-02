import { describe, expect, it } from "vitest";
import { getOnboardingStatus } from "./onboarding-status.js";

const status = (
	auth: { providers: any[] },
	customProviders: { providers: any[] },
	zosmaConfigured = false,
) => getOnboardingStatus({ auth, customProviders, zosmaConfigured });

describe("getOnboardingStatus", () => {
	it("returns false for fresh state", () => {
		expect(status({ providers: [] }, { providers: [] })).toEqual({
			hasExistingSetup: false,
			zosmaConnected: false,
		});
	});

	it("recognizes authenticated provider setup", () => {
		expect(status({ providers: [{ id: "anthropic" }] }, { providers: [] }).hasExistingSetup).toBe(true);
	});

	it("recognizes custom or local provider setup", () => {
		expect(status({ providers: [] }, { providers: [{ id: "ollama-local" }] }).hasExistingSetup).toBe(true);
	});

	it("recognizes usable persisted Zosma setup", () => {
		expect(status({ providers: [] }, { providers: [] }, true)).toEqual({
			hasExistingSetup: true,
			zosmaConnected: true,
		});
	});

	it("recognizes persisted model configuration", () => {
		expect(
			getOnboardingStatus({
				auth: { providers: [] },
				customProviders: { providers: [] },
				savedModelConfiguration: true,
			}),
		).toEqual({ hasExistingSetup: true, zosmaConnected: false });
	});

	it("does not treat runtime model catalog as existing setup", () => {
		expect(status({ providers: [] }, { providers: [] }, false)).toEqual({
			hasExistingSetup: false,
			zosmaConnected: false,
		});
	});

	it("handles malformed values safely", () => {
		expect(getOnboardingStatus({ auth: { providers: null }, customProviders: { providers: null } })).toEqual({
			hasExistingSetup: false,
			zosmaConnected: false,
		});
	});

	it("returns only non-secret booleans", () => {
		const result = getOnboardingStatus({
			auth: { providers: [{ id: "anthropic", secret: "redacted" } as never] },
			customProviders: { providers: [] },
		});
		expect(Object.keys(result)).toEqual(["hasExistingSetup", "zosmaConnected"]);
		expect(JSON.stringify(result)).not.toContain("redacted");
	});
});
