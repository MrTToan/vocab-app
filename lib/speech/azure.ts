/*
 * Azure Speech backend (the PRIMARY path) — raw `fetch`, no SDK.
 *
 *   - "hear it" → Neural TTS REST (SSML → MP3 bytes)
 *   - "say it"  → Speech-to-text REST with the Pronunciation-Assessment header,
 *                 which returns REAL per-syllable accuracy, fluency and
 *                 completeness scores (the good coaching signal).
 *
 * Endpoints are region-scoped: https://<region>.tts.speech.microsoft.com and
 * https://<region>.stt.speech.microsoft.com. The subscription key is sent as
 * `Ocp-Apim-Subscription-Key` and never leaves the server.
 *
 * Usage is metered into the monthly free-tier tally (lib/speech/usage.ts) by the
 * orchestrator in index.ts, not here.
 */

import { azureConfig, azureVoice, speechTimeoutMs } from "./config";
import type { AssessDetail, TtsResult } from "./types";

class AzureSpeechError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "AzureSpeechError";
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Synthesize `text` to MP3 via Azure Neural TTS. Throws on any failure. */
export async function azureTts(text: string): Promise<TtsResult> {
  const cfg = azureConfig();
  if (!cfg) throw new AzureSpeechError("Azure is not configured");
  const voice = azureVoice();
  const ssml =
    `<speak version='1.0' xml:lang='en-US'>` +
    `<voice xml:lang='en-US' name='${escapeXml(voice)}'>${escapeXml(text)}</voice>` +
    `</speak>`;
  const res = await fetch(
    `https://${cfg.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": cfg.key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "lexi-speech",
      },
      body: ssml,
      signal: AbortSignal.timeout(speechTimeoutMs()),
    },
  );
  if (!res.ok) {
    throw new AzureSpeechError(`Azure TTS HTTP ${res.status}: ${(await safeText(res)).slice(0, 200)}`, res.status);
  }
  const audio = new Uint8Array(await res.arrayBuffer());
  return { provider: "azure", audio, mime: "audio/mpeg" };
}

export interface AzureAssessment {
  score: number; // PronScore 0..100
  detail: AssessDetail;
  transcript: string;
}

/**
 * Score a WAV clip against `referenceText` with Azure Pronunciation Assessment.
 * The config travels as a base64 JSON `Pronunciation-Assessment` header. Returns
 * the overall PronScore plus accuracy/fluency/completeness. Throws on transport
 * failure; a clip Azure couldn't recognize comes back as an all-zero score.
 */
export async function azureAssess(
  wav: Uint8Array,
  referenceText: string,
): Promise<AzureAssessment> {
  const cfg = azureConfig();
  if (!cfg) throw new AzureSpeechError("Azure is not configured");
  const paramsJson = JSON.stringify({
    ReferenceText: referenceText,
    GradingSystem: "HundredMark",
    Granularity: "Phoneme",
    Dimension: "Comprehensive",
    EnableMiscue: false,
  });
  const assessHeader = Buffer.from(paramsJson, "utf8").toString("base64");
  const url =
    `https://${cfg.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1` +
    `?language=en-US&format=detailed`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": cfg.key,
      "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
      "Pronunciation-Assessment": assessHeader,
      Accept: "application/json",
      "User-Agent": "lexi-speech",
    },
    // A fresh copy so the body is a clean ArrayBuffer.
    body: wav.slice().buffer,
    signal: AbortSignal.timeout(speechTimeoutMs()),
  });
  if (!res.ok) {
    throw new AzureSpeechError(`Azure assessment HTTP ${res.status}: ${(await safeText(res)).slice(0, 200)}`, res.status);
  }
  const json = (await res.json()) as AzureSttResponse;
  return parseAssessment(json);
}

/* ── response shape (only the fields we read) ─────────────────────────── */
interface AzurePA {
  AccuracyScore?: number;
  FluencyScore?: number;
  CompletenessScore?: number;
  PronScore?: number;
}
interface AzureNBest {
  Display?: string;
  Lexical?: string;
  PronunciationAssessment?: AzurePA;
}
interface AzureSttResponse {
  RecognitionStatus?: string;
  DisplayText?: string;
  NBest?: AzureNBest[];
}

/** Pull the overall + component scores out of a detailed STT response. Exported
 *  for unit testing against captured fixtures. */
export function parseAssessment(json: AzureSttResponse): AzureAssessment {
  const best = json.NBest?.[0];
  const pa = best?.PronunciationAssessment ?? {};
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const detail: AssessDetail = {
    accuracy: num(pa.AccuracyScore),
    fluency: num(pa.FluencyScore),
    completeness: num(pa.CompletenessScore),
  };
  // PronScore is the headline; if absent (e.g. NoMatch) fall back to accuracy.
  const score = typeof pa.PronScore === "number" ? num(pa.PronScore) : detail.accuracy;
  const transcript = best?.Display ?? best?.Lexical ?? json.DisplayText ?? "";
  return { score, detail, transcript };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
