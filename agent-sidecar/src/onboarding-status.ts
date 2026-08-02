/**
 * Pure startup classification. Returns booleans only; never returns Pi state.
 */

export interface OnboardingStatusInput {
	auth?: { providers?: Array<{ id: string; type?: string }> | null };
	customProviders?: { providers?: Array<{ id: string }> | null };
	/** True only when persisted zosmaai-router config has a usable key. */
	zosmaConfigured?: boolean;
	/** True when Pi state contains meaningful saved model configuration. */
	savedModelConfiguration?: boolean;
}

export interface OnboardingStatusResult {
	hasExistingSetup: boolean;
	zosmaConnected: boolean;
}

export function getOnboardingStatus(input: OnboardingStatusInput): OnboardingStatusResult {
	const hasAuth = Array.isArray(input.auth?.providers) && input.auth.providers.length > 0;
	const hasCustom =
		Array.isArray(input.customProviders?.providers) && input.customProviders.providers.length > 0;
	const zosmaConnected = input.zosmaConfigured === true;
	const hasSavedModelConfiguration = input.savedModelConfiguration === true;

	return {
		hasExistingSetup: hasAuth || hasCustom || hasSavedModelConfiguration || zosmaConnected,
		zosmaConnected,
	};
}
