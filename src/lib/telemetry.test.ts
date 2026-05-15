import { afterEach, describe, expect, it, vi } from "vitest";

// Mock @aptabase/tauri before importing the module under test
vi.mock("@aptabase/tauri", () => ({
	trackEvent: vi.fn().mockResolvedValue(undefined),
}));

// Mock @sentry/react before importing
// @sentry/react re-exports from @sentry/browser, so we mock the entry point used by telemetry.ts
const mockSentryInit = vi.fn();
vi.mock("@sentry/react", () => ({
	init: mockSentryInit,
	reactErrorHandler: vi.fn(() => vi.fn()),
}));

const aptabase = await import("@aptabase/tauri");
const {
	initTelemetry,
	resetTelemetry,
	setTelemetryEnabled,
	setSentryDsn,
	trackEvent,
} = await import("./telemetry");

describe("telemetry service", () => {
	afterEach(() => {
		vi.clearAllMocks();
		resetTelemetry();
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
		it("calls aptabase trackEvent with event name", async () => {
			await initTelemetry(true);
			trackEvent("test_event");
			expect(aptabase.trackEvent).toHaveBeenCalledWith("test_event", undefined);
		});

		it("forwards props to aptabase trackEvent", async () => {
			await initTelemetry(true);
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
			setTelemetryEnabled(true);
			setTelemetryEnabled(false);
			trackEvent("after_disable");
			expect(aptabase.trackEvent).not.toHaveBeenCalled();
		});
	});

	describe("initTelemetry", () => {
		it("can be called multiple times safely", async () => {
			await initTelemetry(true);
			await initTelemetry(false);
			await initTelemetry(true);
			trackEvent("multi_init");
			expect(aptabase.trackEvent).toHaveBeenCalledWith("multi_init", undefined);
		});
	});

	describe("error handling", () => {
		it("does not throw when aptabase trackEvent throws", () => {
			setTelemetryEnabled(true);
			vi.mocked(aptabase.trackEvent).mockRejectedValueOnce(new Error("network error"));
			expect(() => trackEvent("fail_event")).not.toThrow();
		});
	});

	describe("Sentry integration", () => {
		it("initializes Sentry when consent is enabled and DSN is set", async () => {
			setSentryDsn("https://key@sentry.io/project");

			await initTelemetry(true);

			expect(mockSentryInit).toHaveBeenCalledWith(
				expect.objectContaining({
					dsn: "https://key@sentry.io/project",
				}),
			);
		});

		it("does not initialize Sentry when DSN is not set", async () => {
			setSentryDsn("");

			await initTelemetry(true);

			expect(mockSentryInit).not.toHaveBeenCalled();
		});

		it("does not initialize Sentry when consent is off", async () => {
			setSentryDsn("https://key@sentry.io/project");

			await initTelemetry(false);

			expect(mockSentryInit).not.toHaveBeenCalled();
		});

		it("only initializes Sentry once", async () => {
			setSentryDsn("https://key@sentry.io/project");

			await initTelemetry(true);
			await initTelemetry(false);
			await initTelemetry(true);

			expect(mockSentryInit).toHaveBeenCalledTimes(1);
		});
	});
});
