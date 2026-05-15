/**
 * Zosma Cowork — Telemetry service
 *
 * Thin wrapper around Aptabase's trackEvent. All calls are no-ops unless
 * consent has been explicitly given via initTelemetry() / setTelemetryEnabled().
 *
 * This module must never throw — telemetry failures must not break the app.
 */

import { trackEvent as aptabaseTrackEvent } from "@aptabase/tauri";

let enabled = false;

export function initTelemetry(isEnabled: boolean): void {
	enabled = isEnabled;
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
