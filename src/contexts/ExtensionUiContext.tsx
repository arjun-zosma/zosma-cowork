import { useExtensionUi } from "@/hooks/useExtensionUi";
import { createContext, useContext } from "react";

/**
 * Shares ONE `useExtensionUi()` instance across the app.
 *
 * The hook registers Tauri `ui_request` / `ui_cancel` listeners, so it must run
 * exactly once. Previously only `ExtensionUiHost` called it — which meant the
 * footer (`StatusLine`) couldn't read extension `setStatus()` chips. Lifting it
 * into a provider lets ambient extension UI render natively wherever it belongs:
 *
 *   - dialogs / toasts / widgets / working badge → ExtensionUiHost
 *   - setStatus() chips                          → StatusLine footer
 *
 * Same pi ExtensionUIContext contract, surfaced in the GUI's native chrome.
 */
type ExtensionUiValue = ReturnType<typeof useExtensionUi>;

const ExtensionUiContext = createContext<ExtensionUiValue | null>(null);

export function ExtensionUiProvider({ children }: { children: React.ReactNode }) {
	const value = useExtensionUi();
	return <ExtensionUiContext.Provider value={value}>{children}</ExtensionUiContext.Provider>;
}

/**
 * Read the shared extension-UI state. Returns `null` outside the provider so
 * leaf components (e.g. StatusLine in tests) can render without it.
 */
export function useExtensionUiContext(): ExtensionUiValue | null {
	return useContext(ExtensionUiContext);
}
