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
  /**
   * Whether Azure actually heard scorable speech. `false` for a NoMatch /
   * silence / babble timeout, where there are NO usable scores — the caller must
   * surface an honest "couldn't hear you" instead of a bogus 0/100.
   */
  recognized: boolean;
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

/* ── response shape (only the fields we read) ─────────────────────────────
 *
 * The pronunciation scores live DIRECTLY on the NBest item in the conversation
 * STT REST response — `NBest[0].AccuracyScore` / `FluencyScore` /
 * `CompletenessScore` / `PronScore` — NOT nested under a `PronunciationAssessment`
 * object (that nested shape is what the Speech SDK surfaces). Reading only the
 * nested path made every real clip score 0, even a spot-on one (verified against
 * live Azure). We read the flat fields first and fall back to the nested object
 * for robustness / SDK-shaped fixtures. A silence/babble/NoMatch response carries
 * a non-"Success" RecognitionStatus and no NBest at all → `recognized: false`. */
interface AzureScores {
  AccuracyScore?: number;
  FluencyScore?: number;
  CompletenessScore?: number;
  PronScore?: number;
}
interface AzureNBest extends AzureScores {
  Display?: string;
  Lexical?: string;
  /** Alternative nesting some Azure surfaces (e.g. the SDK) use. */
  PronunciationAssessment?: AzureScores;
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
  const nested = best?.PronunciationAssessment;
  // Flat (real REST shape) first, nested (SDK shape) as a fallback.
  const pick = (flat: number | undefined, deep: number | undefined): number | undefined =>
    typeof flat === "number" ? flat : typeof deep === "number" ? deep : undefined;
  const accuracy = pick(best?.AccuracyScore, nested?.AccuracyScore);
  const fluency = pick(best?.FluencyScore, nested?.FluencyScore);
  const completeness = pick(best?.CompletenessScore, nested?.CompletenessScore);
  const pron = pick(best?.PronScore, nested?.PronScore);

  const num = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const detail: AssessDetail = {
    accuracy: num(accuracy),
    fluency: num(fluency),
    completeness: num(completeness),
  };
  // PronScore is the headline; if absent fall back to accuracy.
  const score = pron !== undefined ? num(pron) : detail.accuracy;
  const transcript = best?.Display ?? best?.Lexical ?? json.DisplayText ?? "";

  // Did Azure actually score speech? A recognized clip has an NBest item with at
  // least one score; a silence/babble/NoMatch timeout has a non-"Success" status
  // and no scorable NBest. Treat "Success" (or an absent status, for lenient
  // fixtures) with a real score as recognized.
  const hasScore = accuracy !== undefined || pron !== undefined;
  const status = json.RecognitionStatus;
  const statusOk = status === undefined || status === "Success";
  const recognized = !!best && hasScore && statusOk;

  return { score, detail, transcript, recognized };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
