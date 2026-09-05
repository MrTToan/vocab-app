/*
 * Shared types for the two-way pronunciation module (lib/speech/**).
 *
 * Two directions:
 *   - "hear it"  → TTS: synthesize a word / example into speech.
 *   - "say it"   → assessment: score the learner's own recording.
 *
 * Each direction has an Azure-primary / OpenAI-fallback provider (see index.ts).
 * `method` keeps the UI (and this code) honest about WHAT was measured:
 *   - "phoneme"    → Azure Pronunciation Assessment: real per-syllable accuracy,
 *                    fluency and completeness scores.
 *   - "word-match" → OpenAI Whisper transcription compared to the target word.
 *                    This is a did-you-say-the-right-word check, NOT phoneme
 *                    scoring — there is no accuracy number behind it.
 */

export type SpeechProvider = "azure" | "openai";

/** The synthesized audio for "hear it". */
export interface TtsResult {
  provider: SpeechProvider;
  audio: Uint8Array;
  /** MIME of `audio`, e.g. "audio/mpeg". */
  mime: string;
}

/** Per-syllable/word detail — only Azure supplies these (null on the OpenAI path). */
export interface AssessDetail {
  accuracy: number; // 0..100
  fluency: number; // 0..100
  completeness: number; // 0..100
}

/** The graded result for "say it". */
export interface AssessResult {
  provider: SpeechProvider;
  /** 0..100 pronunciation score (Azure). null on the OpenAI word-match path. */
  score: number | null;
  verdict: "good" | "needs-work";
  /** What the recognizer heard. */
  transcript: string;
  /** The target word we compared against. */
  reference: string;
  /** One short, encouraging line for the learner. */
  feedback: string;
  /** Azure phoneme detail, or null on the OpenAI path. */
  detail: AssessDetail | null;
  method: "phoneme" | "word-match";
}

/** Which directions are currently usable (drives the UI show/hide). */
export interface SpeechAvailability {
  tts: boolean;
  assess: boolean;
}

/** No usable speech provider for the requested direction — the routes map this to
 *  a friendly "speech unavailable" response and the UI hides the control. */
export class SpeechUnavailableError extends Error {
  constructor(message = "Speech is unavailable right now.") {
    super(message);
    this.name = "SpeechUnavailableError";
  }
}
