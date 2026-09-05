/*
 * Speech-provider configuration & credential resolution.
 *
 * Two providers, one strategy (see index.ts): Azure is PRIMARY (burn its
 * generous free F0 tier first), OpenAI is the automatic FALLBACK.
 *
 *   - Azure:  AZURE_SPEECH_KEY + AZURE_SPEECH_REGION (env). Not provisioned yet
 *             in prod — the whole feature MUST work on OpenAI alone until these
 *             are set, at which point the Azure path activates automatically.
 *   - OpenAI: REUSES the existing multi-provider LLM wiring — we do NOT add a
 *             second OpenAI key mechanism. `resolveOpenAI()` scans the configured
 *             LLM chain (`lib/providers.ts`) for the entry that points at
 *             api.openai.com and lifts its key + base URL. TTS/Whisper live under
 *             the same base URL (/audio/speech, /audio/transcriptions).
 *
 * Nothing here ever reaches the browser — all keys stay server-side.
 */

import { resolveChain } from "@/lib/providers";

function env(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

function envInt(name: string, fallback: number): number {
  const v = env(name);
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/* ─────────────────────────────  Azure  ───────────────────────────── */

export interface AzureConfig {
  key: string;
  region: string;
}

/** Azure Speech config, or null when the key/region aren't set (the common case
 *  today — the OpenAI fallback carries the feature). */
export function azureConfig(): AzureConfig | null {
  const key = env("AZURE_SPEECH_KEY");
  const region = env("AZURE_SPEECH_REGION");
  if (!key || !region) return null;
  return { key, region };
}

export function azureConfigured(): boolean {
  return azureConfig() !== null;
}

/** Azure Neural TTS voice (en-US). Override with AZURE_TTS_VOICE. */
export function azureVoice(): string {
  return env("AZURE_TTS_VOICE") ?? "en-US-JennyNeural";
}

/**
 * Approximate monthly free-tier budgets used to decide "Azure exhausted → fall
 * back to OpenAI" (see lib/speech/usage.ts). Azure's free F0 tier is roughly
 * 0.5M TTS chars/month + ~5 audio-hours/month of speech. We stay a hair under so
 * we switch to OpenAI BEFORE Azure starts 429-ing, but Azure's own error is also
 * caught and falls back — this ledger is a courtesy, not the only safety net.
 */
export function azureTtsCharBudget(): number {
  return envInt("AZURE_TTS_CHAR_BUDGET", 480_000); // ~0.5M, with headroom
}
export function azureAssessSecondsBudget(): number {
  return envInt("AZURE_ASSESS_SECONDS_BUDGET", 17_000); // ~5h (18000s), with headroom
}

/* ─────────────────────────────  OpenAI  ───────────────────────────── */

export interface OpenAiConfig {
  apiKey: string;
  /** Normalized base URL (no trailing slash), e.g. "https://api.openai.com/v1". */
  baseUrl: string;
}

/**
 * Lift OpenAI creds out of the existing LLM chain: the first configured provider
 * whose base URL host is api.openai.com and that carries a key. Returns null when
 * OpenAI isn't in the chain (e.g. a Gemini-only or Anthropic-only deploy) — then
 * the OpenAI speech path is simply unavailable. `resolveChain` covers the
 * numbered chain, single `LLM_MODE=custom`, and default modes, so no new env var
 * is introduced.
 */
export function resolveOpenAI(): OpenAiConfig | null {
  for (const c of resolveChain("score")) {
    if (c.provider !== "openai" || !c.apiKey) continue;
    const raw = c.baseUrl ?? "https://api.openai.com/v1";
    let host = "";
    try {
      host = new URL(raw).host.toLowerCase();
    } catch {
      continue;
    }
    if (host === "api.openai.com") {
      return { apiKey: c.apiKey, baseUrl: raw.replace(/\/+$/, "") };
    }
  }
  return null;
}

export function openAiConfigured(): boolean {
  return resolveOpenAI() !== null;
}

/** OpenAI TTS model + voice (override with OPENAI_TTS_MODEL / OPENAI_TTS_VOICE). */
export function openAiTtsModel(): string {
  return env("OPENAI_TTS_MODEL") ?? "tts-1";
}
export function openAiTtsVoice(): string {
  return env("OPENAI_TTS_VOICE") ?? "alloy";
}
/** OpenAI transcription model (override with OPENAI_STT_MODEL). */
export function openAiSttModel(): string {
  return env("OPENAI_STT_MODEL") ?? "whisper-1";
}

/* ─────────────────────────────  shared  ───────────────────────────── */

/** Score (0..100) at/above which a "say it" attempt counts as good. Product
 *  default 70; override with SPEECH_PASS_SCORE. */
export function passScore(): number {
  const n = Number(env("SPEECH_PASS_SCORE"));
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 70;
}

/** One HTTP-attempt timeout for a speech call (ms). Override SPEECH_TIMEOUT_MS. */
export function speechTimeoutMs(): number {
  return envInt("SPEECH_TIMEOUT_MS", 20_000);
}
