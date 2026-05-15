/**
 * Zosma Cowork — useTelemetry hook
 *
 * Manages telemetry consent state, synchronized with:
 * 1. Rust-side TelemetryState (via set_telemetry_enabled IPC)
 * 2. Settings persistence (via save_settings IPC)
 * 3. Frontend telemetry service gating
 */

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import {
	initTelemetry as initTelemetryService,
	setTelemetryEnabled as setServiceTelemetryEnabled,
	trackEvent as serviceTrackEvent,
} from "@/lib/telemetry";

export interface UseTelemetryReturn {
	isEnabled: boolean;
	enable: () => Promise<void>;
	disable: () => Promise<void>;
	trackEvent: (name: string, props?: Record<string, string | number>) => void;
}

export function useTelemetry(): UseTelemetryReturn {
	const [isEnabled, setIsEnabled] = useState(false);

	// Load initial state from settings on mount
	useEffect(() => {
		let cancelled = false;

		invoke<{ telemetry?: { enabled?: boolean } }>("get_settings")
			.then((settings) => {
				if (cancelled) return;
				const enabled = settings?.telemetry?.enabled ?? false;
				setIsEnabled(enabled);
				initTelemetryService(enabled);
			})
			.catch(() => {
				// Settings not available yet — default to disabled
				if (!cancelled) {
					setIsEnabled(false);
					initTelemetryService(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, []);

	const enable = useCallback(async () => {
		setIsEnabled(true);
		setServiceTelemetryEnabled(true);
		try {
			await invoke("set_telemetry_enabled", { enabled: true });
			await invoke("save_settings", { settings: { telemetry: { enabled: true } } });
		} catch {
			// Silently fail — telemetry should not block the app
		}
	}, []);

	const disable = useCallback(async () => {
		setIsEnabled(false);
		setServiceTelemetryEnabled(false);
		try {
			await invoke("set_telemetry_enabled", { enabled: false });
			await invoke("save_settings", { settings: { telemetry: { enabled: false } } });
		} catch {
			// Silently fail
		}
	}, []);

	const trackEvent = useCallback(
		(name: string, props?: Record<string, string | number>) => {
			serviceTrackEvent(name, props);
		},
		[],
	);

	return {
		isEnabled,
		enable,
		disable,
		trackEvent,
	};
}
