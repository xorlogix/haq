/**
 * Resolve which credentials the caseworker agent should use.
 *
 * Order:
 *   1. An explicit API key from the environment (HAQ_API_KEY / CLINE_API_KEY /
 *      provider-specific fallbacks) — see server/config.ts.
 *   2. The Cline account this machine is already signed into (only for the
 *      "cline" and "cline-pass" providers) — so judges/teammates get live AI
 *      with zero config, reusing the same sign-in as the Cline app/extension.
 *   3. The offline demo model (also forced by HAQ_MODE=demo).
 *
 * Resolved fresh on every call (not cached) so a token refreshed by the Cline
 * app mid-session is picked up the next time a case agent is created. Never
 * log or return the token itself in any user-facing text — only a source label.
 */
import { ProviderSettingsManager, resolveLocalClineAuthToken } from "@cline/sdk";
import { MODEL_CONFIG } from "../config.js";

export type CredentialSource = "env" | "cline-signin" | "demo";

export interface ResolvedCredentials {
  mode: "demo" | "live";
  apiKey?: string;
  source: CredentialSource;
}

const CLINE_SIGNIN_PROVIDERS = new Set(["cline", "cline-pass"]);

let settingsManager: ProviderSettingsManager | undefined;
function getSettingsManager(): ProviderSettingsManager {
  if (!settingsManager) settingsManager = new ProviderSettingsManager();
  return settingsManager;
}

/** Looks for a usable token from the local Cline sign-in, without ever exposing it in logs. */
function findLocalClineToken(providerId: string): string | undefined {
  if (!CLINE_SIGNIN_PROVIDERS.has(providerId)) return undefined;
  try {
    const settings = getSettingsManager().getProviderSettings(providerId);
    return resolveLocalClineAuthToken(settings);
  } catch {
    // No local Cline config on this machine (fresh install, no sign-in, etc).
    return undefined;
  }
}

export function resolveCredentials(): ResolvedCredentials {
  if (MODEL_CONFIG.forcedDemo) return { mode: "demo", source: "demo" };

  if (MODEL_CONFIG.envApiKey) {
    return { mode: "live", apiKey: MODEL_CONFIG.envApiKey, source: "env" };
  }

  const localToken = findLocalClineToken(MODEL_CONFIG.providerId);
  if (localToken) {
    return { mode: "live", apiKey: localToken, source: "cline-signin" };
  }

  if (MODEL_CONFIG.keylessProviders.has(MODEL_CONFIG.providerId)) {
    return { mode: "live", source: "env" };
  }

  return { mode: "demo", source: "demo" };
}

export function credentialSourceLabel(source: CredentialSource): string {
  switch (source) {
    case "env":
      return "env key";
    case "cline-signin":
      return "signed-in Cline account";
    case "demo":
      return "offline demo";
  }
}
