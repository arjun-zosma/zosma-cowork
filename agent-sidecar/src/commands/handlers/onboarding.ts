/**
 * Onboarding status handler: get_onboarding_status.
 *
 * Composes data from existing commands (get_auth_status, list_custom_providers)
 * and passes them to the pure getOnboardingStatus() function.
 */

import { send as sendMsg } from "../../protocol.js";
import { getOnboardingStatus } from "../../onboarding-status.js";
import type { HandlerDependencies } from "../handler-registry.js";

export async function handleGetOnboardingStatus(
  deps: HandlerDependencies,
  cmd: any,
): Promise<void> {
  if (!deps.initialized || !deps.authStorage || !deps.modelRegistry) {
    sendMsg({ type: "error", id: cmd.id, message: "Not initialized" });
    return;
  }

  try {
    // 1. Auth providers. Malformed auth storage is treated as empty for
    // onboarding; existing auth flows retain their own error semantics.
    const providers: Array<{ id: string; type?: string }> = [];
    try {
      for (const providerId of deps.authStorage.list()) {
        const cred = deps.authStorage.get(providerId);
        if (!cred) continue;
        providers.push({ id: providerId, type: cred.type });
      }
    } catch {
      // fail soft: malformed/missing auth state is not existing setup
    }

    // 2. Custom/local providers
    let customProviders: Array<{ id: string }> = [];
    try {
      const { listCustomProviders } = await import("../../custom-providers.js");
      const { join } = await import("node:path");
      const { piAgentDir } = await import("../../agent-init.js");
      const modelsPath = join(piAgentDir(), "models.json");
      const result = listCustomProviders(modelsPath);
      if (Array.isArray(result)) {
        customProviders = result.map((p: any) => ({ id: p.id }));
      }
    } catch {
      // fail soft
    }

    // 3. Managed Zosma setup must come from persisted models.json, not the
    // runtime registry (extensions may register catalog entries on fresh installs).
    let zosmaConfigured = false;
    let savedModelConfiguration = false;
    try {
      const { readProviderEntry } = await import("../../custom-providers.js");
      const { join } = await import("node:path");
      const { readFileSync } = await import("node:fs");
      const { piAgentDir } = await import("../../agent-init.js");
      const modelsPath = join(piAgentDir(), "models.json");
      const provider = readProviderEntry(modelsPath, "zosmaai-router");
      zosmaConfigured = typeof provider?.apiKey === "string" && provider.apiKey.trim().length > 0;

      // Persisted provider/model entries count; an empty or malformed file does not.
      const raw = JSON.parse(readFileSync(modelsPath, "utf8")) as {
        providers?: Record<string, { models?: unknown[] }>;
      };
      savedModelConfiguration = Object.entries(raw.providers ?? {}).some(
        ([id, entry]) => id !== "zosmaai-router" && Array.isArray(entry?.models) && entry.models.length > 0,
      );
    } catch {
      // missing/malformed models.json is fresh state
    }

    const input = {
      auth: { providers },
      customProviders: { providers: customProviders },
      zosmaConfigured,
      savedModelConfiguration,
    };

    const status = getOnboardingStatus(input);
    sendMsg({ type: "result", id: cmd.id, data: status });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    sendMsg({ type: "error", id: cmd.id, message: msg });
  }
}
