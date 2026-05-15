/**
 * Zosma Cowork — Telemetry service
 *
 * Thin wrapper around Aptabase's trackEvent and Sentry crash reporting.
 * All calls are no-ops unless consent has been explicitly given via
 * initTelemetry() / setTelemetryEnabled().
 *
 * Sentry is loaded lazily (dynamic import) so its bundle is only fetched
 * when the user opts in. The Sentry DSN is configured via the SENTRY_DSN
 * build-time constant, or via setSentryDsn() at runtime.
 *
 * This module must never throw — telemetry failures must not break the app.
 */

import { trackEvent as aptabaseTrackEvent } from "@aptabase/tauri";

let enabled = false;
let sentryInitialized = false;
let sentryDsn = "";

/**
 * Set the Sentry DSN at runtime. Called early in app startup.
 * In production builds, this is set from VITE_SENTRY_DSN env var.
 */
export function setSentryDsn(dsn: string): void {
	sentryDsn = dsn;
}

/**
 * Reset telemetry state (primarily for testing).
 * Clears the Sentry-initialized flag so tests start clean.
 */
export function resetTelemetry(): void {
	sentryInitialized = false;
	enabled = false;
}

export async function initTelemetry(isEnabled: boolean): Promise<void> {
	enabled = isEnabled;

	if (isEnabled) {
		await initSentry();
	}
}

export function setTelemetryEnabled(isEnabled: boolean): void {
	enabled = isEnabled;
}

export function trackEvent(
	name: string,
	props?: Record<string, string | number>,
): void {
	if (!enabled) return;

	// Fire-and-forget — we don't await the promise because telemetry
	// should never block or delay the UI. Catch to prevent unhandled
	// promise rejections.
	void aptabaseTrackEvent(name, props).catch(() => {});
}

/**
 * Initialize Sentry for crash reporting.
 * Only initializes once regardless of how many times called.
 */
async function initSentry(): Promise<void> {
	if (sentryInitialized) return;

	try {
		if (!sentryDsn) return;

		const Sentry = await import("@sentry/browser");

		Sentry.init({
			dsn: sentryDsn,
			// Minimal footprint — no replay, no performance
			replaysSessionSampleRate: 0,
			replaysOnErrorSampleRate: 0,
			tracesSampleRate: 0,
		});

		sentryInitialized = true;
	} catch {
		// Sentry init failure must never break the app
	}
}
