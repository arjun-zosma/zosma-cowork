/**
 * Zosma Router Auth — Command Handlers.
 *
 * Wrappers for zosma auth commands.
 * Lazy-import the implementation to avoid pulling in network code at startup.
 */

import { piAgentDir } from "../../agent-init.js";
import { send as sendMsg } from "../../protocol.js";
import type { HandlerDependencies } from "../handler-registry.js";

export async function handleStartZosmaAuth(_deps: HandlerDependencies, cmd: any): Promise<void> {
	try {
		const { startZosmaAuth } = await import("../../zosma-auth/index.js");
		const result = await startZosmaAuth(piAgentDir());
		sendMsg({ type: "result", id: cmd.id, data: result });
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		sendMsg({ type: "error", id: cmd.id, message: msg });
	}
}

export async function handleCompleteZosmaAuth(deps: HandlerDependencies, cmd: any): Promise<void> {
	try {
		const { completeZosmaAuth } = await import("../../zosma-auth/index.js");
		const result = await completeZosmaAuth(cmd.code, cmd.state, piAgentDir(), deps);
		sendMsg({ type: "result", id: cmd.id, data: result });
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		sendMsg({ type: "error", id: cmd.id, message: msg });
	}
}

export async function handleCancelZosmaAuth(_deps: HandlerDependencies, cmd: any): Promise<void> {
	try {
		const { cancelZosmaAuth } = await import("../../zosma-auth/index.js");
		await cancelZosmaAuth(piAgentDir());
		sendMsg({ type: "result", id: cmd.id, data: { cancelled: true } });
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		sendMsg({ type: "error", id: cmd.id, message: msg });
	}
}

export async function handleRefreshZosmaModels(deps: HandlerDependencies, cmd: any): Promise<void> {
	try {
		const { refreshZosmaModels } = await import("../../zosma-auth/index.js");
		const result = await refreshZosmaModels(piAgentDir(), deps);
		sendMsg({ type: "result", id: cmd.id, data: result });
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		sendMsg({ type: "error", id: cmd.id, message: msg });
	}
}

export async function handleGetZosmaUsage(_deps: HandlerDependencies, cmd: any): Promise<void> {
	try {
		const { getZosmaUsage } = await import("../../zosma-auth/index.js");
		const result = await getZosmaUsage(piAgentDir());
		sendMsg({ type: "result", id: cmd.id, data: result });
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		sendMsg({ type: "error", id: cmd.id, message: msg });
	}
}

export async function handleDisconnectZosmaAuth(deps: HandlerDependencies, cmd: any): Promise<void> {
	try {
		const { disconnectZosmaAuth } = await import("../../zosma-auth/index.js");
		await disconnectZosmaAuth(piAgentDir(), deps);
		sendMsg({ type: "result", id: cmd.id, data: { disconnected: true } });
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		sendMsg({ type: "error", id: cmd.id, message: msg });
	}
}

export async function handleConfigureRouter(_deps: HandlerDependencies, cmd: any): Promise<void> {
	try {
		const { setZosmaAuthConfig, saveRouterConfig } = await import("../../zosma-auth/index.js");
		setZosmaAuthConfig({
			authBaseUrl: cmd.authBaseUrl,
			routerBaseUrl: cmd.routerBaseUrl,
		});
		// Persist to file so config survives sidecar restart
		saveRouterConfig(piAgentDir(), {
			authBaseUrl: cmd.authBaseUrl,
			routerBaseUrl: cmd.routerBaseUrl,
		});
		sendMsg({ type: "result", id: cmd.id, data: { configured: true } });
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		sendMsg({ type: "error", id: cmd.id, message: msg });
	}
}