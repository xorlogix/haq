import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..");
export const DATA_DIR = path.resolve(ROOT, process.env.HAQ_DATA_DIR ?? "data");
export const CASES_DIR = path.join(DATA_DIR, "cases");
export const PUBLIC_DIR = path.join(ROOT, "public");
export const KB_DIR = path.join(here, "kb");

export const PORT = Number(process.env.PORT ?? 3000);

/**
 * Model configuration. Haq runs its caseworker on the Cline SDK, so any provider
 * the SDK supports works. Defaults to Cline's own API.
 *
 * Credential order (see server/agent/credentials.ts, resolved fresh for every
 * agent — not just at startup — so a refreshed local sign-in is picked up):
 *   1. HAQ_API_KEY / CLINE_API_KEY (or ANTHROPIC_API_KEY / OPENAI_API_KEY /
 *      GEMINI_API_KEY for non-Cline providers) — explicit env key.
 *   2. The Cline account this machine is already signed into (providers
 *      "cline" / "cline-pass" only) — zero config for judges/teammates.
 *   3. The offline demo model (HAQ_MODE=demo also forces this).
 *
 * HAQ_MODE=demo forces the offline scripted model (no API key or sign-in
 * needed): the real Cline agent loop and real tools still run — only the LLM
 * is replaced.
 */
const envApiKey =
  process.env.HAQ_API_KEY ??
  process.env.CLINE_API_KEY ??
  process.env.ANTHROPIC_API_KEY ??
  process.env.OPENAI_API_KEY ??
  process.env.GEMINI_API_KEY;

const forcedDemo = (process.env.HAQ_MODE ?? "").toLowerCase() === "demo";
const providerId = process.env.HAQ_PROVIDER ?? "cline";
const keylessProviders = new Set(["ollama", "lmstudio"]);

export const MODEL_CONFIG = {
  providerId,
  modelId: process.env.HAQ_MODEL ?? "anthropic/claude-sonnet-5",
  baseUrl: process.env.HAQ_BASE_URL || undefined,
  maxIterations: Number(process.env.HAQ_MAX_ITERATIONS ?? 24),
  envApiKey,
  forcedDemo,
  keylessProviders,
};
