/*
 * Speech orchestration: Azure PRIMARY, OpenAI FALLBACK, automatic + graceful.
 *
 * For each direction ("hear it" / "say it") we try Azure first — but only when
 * it's configured AND its tracked monthly free-tier budget isn't spent — and
 * fall back to OpenAI when Azure is unconfigured, over budget, or errors. If
 * NEITHER provider is usable we throw SpeechUnavailableError, which the routes
 * turn into a friendly "speech unavailable" response and the UI hides the
 * control. The learner never sees a hard failure just because Azure ran out.
 */

import {
  azureConfigured,
  openAiConfigured,
  azureTtsCharBudget,
  azureAssessSecondsBudget,
  passScore,
} from "./config";
import { azureTts, azureAssess } from "./azure";
import { openaiTts, openaiTranscribe } from "./openai";
import { azureBudgetExceeded, recordAzureUsage } from "./usage";
import { parseWav } from "./wav";
import { wordMatch } from "./match";
import {
  type AssessResult,
  type SpeechAvailability,
  type TtsResult,
  SpeechUnavailableError,
} from "./types";

export * from "./types";

/** Which directions can run right now (drives the UI show/hide via /api/config). */
export function speechAvailability(): SpeechAvailability {
  const any = azureConfigured() || openAiConfigured();
  // Both directions share the same two providers, so availability is symmetric.
  return { tts: any, assess: any };
}

/* ─────────────────────────────  hear it  ───────────────────────────── */

/**
 * Synthesize `text` to speech. Azure first (within budget), else OpenAI.
 * Throws SpeechUnavailableError only when no provider is usable.
 */
export async function synthesizeSpeech(text: string): Promise<TtsResult> {
  const clean = text.trim().slice(0, 500); // keep TTS spend bounded
  if (!clean) throw new SpeechUnavailableError("Nothing to say.");

  if (azureConfigured() && !(await azureBudgetExceeded("tts_chars", azureTtsCharBudget(), clean.length))) {
    try {
      const out = await azureTts(clean);
      await recordAzureUsage("tts_chars", clean.length);
      return out;
    } catch (err) {
      logFallback("tts", err);
    }
  }

  if (openAiConfigured()) return openaiTts(clean);
  throw new SpeechUnavailableError();
}

/* ─────────────────────────────  say it  ───────────────────────────── */

/**
 * Assess the learner's WAV recording of `word`. Azure Pronunciation Assessment
 * first (real phoneme scoring), else OpenAI Whisper transcription → word-match.
 * `word` is the target; we compare against it. Throws SpeechUnavailableError
 * when no provider is usable, or a plain Error for a malformed upload.
 */
export async function assessPronunciation(
  wav: Uint8Array,
  word: string,
): Promise<AssessResult> {
  const info = parseWav(wav);
  if (!info) throw new Error("The recording wasn't valid WAV audio.");
  const seconds = Math.max(1, Math.ceil(info.seconds));
  const reference = word.trim();

  if (azureConfigured() && !(await azureBudgetExceeded("assess_seconds", azureAssessSecondsBudget(), seconds))) {
    try {
      const a = await azureAssess(wav, reference);
      await recordAzureUsage("assess_seconds", seconds);
      const verdict = a.score >= passScore() ? "good" : "needs-work";
      return {
        provider: "azure",
        score: Math.round(a.score),
        verdict,
        transcript: a.transcript,
        reference,
        detail: a.detail,
        method: "phoneme",
        feedback: azureFeedback(verdict, a.score, a.transcript, reference),
      };
    } catch (err) {
      logFallback("assess", err);
    }
  }

  if (openAiConfigured()) {
    const transcript = await openaiTranscribe(wav);
    const { verdict, exact } = wordMatch(transcript, reference);
    return {
      provider: "openai",
      score: null, // word-match has no phoneme score — be honest
      verdict,
      transcript,
      reference,
      detail: null,
      method: "word-match",
      feedback: openaiFeedback(verdict, exact, transcript, reference),
    };
  }

  throw new SpeechUnavailableError();
}

/* ─────────────────────────────  feedback lines  ─────────────────────── */

function azureFeedback(
  verdict: "good" | "needs-work",
  score: number,
  transcript: string,
  reference: string,
): string {
  if (verdict === "good") {
    return score >= 90
      ? `Excellent — that sounded spot on! (${Math.round(score)}/100)`
      : `Nice work — clear and understandable. (${Math.round(score)}/100)`;
  }
  if (transcript && !looksLike(transcript, reference)) {
    return `Almost — that came through more like “${transcript.trim()}”. Try “${reference}” once more, a little slower. (${Math.round(score)}/100)`;
  }
  return `Getting there — say “${reference}” again, a little slower and clearer. (${Math.round(score)}/100)`;
}

function openaiFeedback(
  verdict: "good" | "needs-work",
  exact: boolean,
  transcript: string,
  reference: string,
): string {
  if (verdict === "good") {
    return exact
      ? `Great — that came through clearly as “${reference}”.`
      : `Good — close enough to “${reference}” to be understood.`;
  }
  if (transcript.trim()) {
    return `That sounded more like “${transcript.trim()}”. Give “${reference}” another go, a little slower.`;
  }
  return `I couldn't quite catch that — try saying “${reference}” again, closer to the mic.`;
}

function looksLike(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function logFallback(dir: "tts" | "assess", err: unknown): void {
  console.warn(
    `[speech] Azure ${dir} failed, falling back to OpenAI: ${err instanceof Error ? err.message : String(err)}`,
  );
}
