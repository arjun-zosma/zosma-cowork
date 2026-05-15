import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock @aptabase/tauri before importing the module under test
vi.mock("@aptabase/tauri", () => ({
	trackEvent: vi.fn().mockResolvedValue(undefined),
}));

// Import after mock is set up
const aptabase = await import("@aptabase/tauri");

const { initTelemetry, setTelemetryEnabled, trackEvent } = await import("./telemetry");

describe("telemetry service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset to disabled state between tests
		initTelemetry(false);
	});

	describe("trackEvent with consent OFF", () => {
		it("does not call aptabase trackEvent when consent is off", () => {
			trackEvent("test_event");
			expect(aptabase.trackEvent).not.toHaveBeenCalled();
		});

		it("does not forward props when consent is off", () => {
			trackEvent("test_event", { key: "value" });
			expect(aptabase.trackEvent).not.toHaveBeenCalled();
		});
	});

	describe("trackEvent with consent ON", () => {
		it("calls aptabase trackEvent with event name", () => {
			initTelemetry(true);
			trackEvent("test_event");
			expect(aptabase.trackEvent).toHaveBeenCalledWith("test_event", undefined);
		});

		it("forwards props to aptabase trackEvent", () => {
			initTelemetry(true);
			const props = { key: "value", count: 42 };
			trackEvent("test_event", props);
			expect(aptabase.trackEvent).toHaveBeenCalledWith("test_event", props);
		});
	});

	describe("setTelemetryEnabled", () => {
		it("enables future trackEvent calls", () => {
			setTelemetryEnabled(true);
			trackEvent("after_enable");
			expect(aptabase.trackEvent).toHaveBeenCalledWith("after_enable", undefined);
		});

		it("disables future trackEvent calls", () => {
			initTelemetry(true);
			setTelemetryEnabled(false);
			trackEvent("after_disable");
			expect(aptabase.trackEvent).not.toHaveBeenCalled();
		});
	});

	describe("initTelemetry", () => {
		it("can be called multiple times safely", () => {
			initTelemetry(true);
			initTelemetry(false);
			initTelemetry(true);
			trackEvent("multi_init");
			expect(aptabase.trackEvent).toHaveBeenCalledWith("multi_init", undefined);
		});
	});

	describe("error handling", () => {
		it("does not throw when aptabase trackEvent throws", () => {
			initTelemetry(true);
			vi.mocked(aptabase.trackEvent).mockRejectedValueOnce(new Error("network error"));
			expect(() => trackEvent("fail_event")).not.toThrow();
		});
	});
});
