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
import { wordMatch, sentenceMatch } from "./match";
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
 * Assess the learner's WAV recording against `reference`. Azure Pronunciation
 * Assessment first (real phoneme scoring), else OpenAI Whisper transcription →
 * an approximate matcher. `mode` selects what we're scoring:
 *   - "word"     (default): a single target word — word-match on the fallback.
 *   - "sentence": the whole completed sentence — a sentence-level matcher on the
 *                 fallback, and the fluency/completeness breakdown surfaced from
 *                 Azure (these matter for a sentence in a way they don't for a
 *                 word). Azure's ReferenceText handles a full sentence natively.
 * Throws SpeechUnavailableError when no provider is usable, or a plain Error for
 * a malformed upload.
 */
export async function assessPronunciation(
  wav: Uint8Array,
  reference: string,
  mode: "word" | "sentence" = "word",
): Promise<AssessResult> {
  const info = parseWav(wav);
  if (!info) throw new Error("The recording wasn't valid WAV audio.");
  const seconds = Math.max(1, Math.ceil(info.seconds));
  const ref = reference.trim();
  const label = mode === "sentence" ? "that sentence" : `“${ref}”`;

  if (azureConfigured() && !(await azureBudgetExceeded("assess_seconds", azureAssessSecondsBudget(), seconds))) {
    try {
      const a = await azureAssess(wav, ref);
      await recordAzureUsage("assess_seconds", seconds);
      // Azure couldn't make out any speech (silence / babble / NoMatch): be honest
      // — this is "we didn't catch that", NOT a 0/100 the learner earned.
      if (!a.recognized) {
        return {
          provider: "azure",
          score: 0,
          verdict: "unclear",
          transcript: "",
          reference: ref,
          detail: null,
          method: "phoneme",
          feedback: `I couldn't quite catch that — check your mic is on, then say ${label} again, a little louder and clearer.`,
        };
      }
      const verdict = a.score >= passScore() ? "good" : "needs-work";
      return {
        provider: "azure",
        score: Math.round(a.score),
        verdict,
        transcript: a.transcript,
        reference: ref,
        detail: a.detail,
        method: "phoneme",
        feedback:
          mode === "sentence"
            ? azureSentenceFeedback(verdict, a.score, a.detail)
            : azureFeedback(verdict, a.score, a.transcript, ref),
      };
    } catch (err) {
      logFallback("assess", err);
    }
  }

  if (openAiConfigured()) {
    const transcript = await openaiTranscribe(wav);
    if (mode === "sentence") {
      const { verdict, score, completeness } = sentenceMatch(transcript, ref, passScore());
      return {
        provider: "openai",
        // An APPROXIMATE closeness score (whole-string similarity blended with
        // how many of the sentence's words were said) — NOT phoneme accuracy.
        score,
        verdict,
        transcript,
        reference: ref,
        // Accuracy/fluency aren't measured on the fallback, so we don't claim a
        // phoneme detail row; the completeness signal is surfaced in the feedback.
        detail: null,
        method: "word-match",
        feedback: openaiSentenceFeedback(verdict, transcript, score, completeness),
      };
    }
    const { verdict, exact, score } = wordMatch(transcript, ref, passScore());
    return {
      provider: "openai",
      // An APPROXIMATE closeness score (edit-distance + phonetic), not phoneme
      // accuracy — the UI labels it as such. Verdict is derived from it.
      score,
      verdict,
      transcript,
      reference: ref,
      detail: null,
      method: "word-match",
      feedback: openaiFeedback(verdict, exact, transcript, ref, score),
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

function azureSentenceFeedback(
  verdict: "good" | "needs-work",
  score: number,
  detail: { fluency: number; completeness: number } | null,
): string {
  const s = Math.round(score);
  const bits: string[] = [];
  if (detail) {
    bits.push(`fluency ${Math.round(detail.fluency)}`);
    bits.push(`completeness ${Math.round(detail.completeness)}`);
  }
  const breakdown = bits.length ? ` (${bits.join(", ")})` : "";
  if (verdict === "good") {
    return score >= 90
      ? `Excellent — that whole sentence sounded natural and clear!${breakdown} (${s}/100)`
      : `Nice — the sentence came through clearly.${breakdown} (${s}/100)`;
  }
  if (detail && detail.completeness < 70) {
    return `Getting there — try to say the whole sentence, not just part of it, a little slower.${breakdown} (${s}/100)`;
  }
  return `Getting there — read the sentence again, a little slower and more evenly.${breakdown} (${s}/100)`;
}

function openaiSentenceFeedback(
  verdict: "good" | "needs-work",
  transcript: string,
  score: number,
  completeness: number,
): string {
  // `score` is an approximate closeness number (0..100), shown with an "approx."
  // qualifier — never overclaimed as clinical per-sound accuracy.
  const approx = `(~${score}/100 approx., ${completeness}% of the words)`;
  if (verdict === "good") {
    return `Good — that read through clearly as the sentence. ${approx}`;
  }
  if (completeness < 70) {
    return `I only caught part of it${transcript.trim() ? ` (“${transcript.trim()}”)` : ""} — try reading the whole sentence, a little slower. ${approx}`;
  }
  if (transcript.trim()) {
    return `That came through as “${transcript.trim()}”. Read the sentence again, a little slower. ${approx}`;
  }
  return `I couldn't quite catch that — read the sentence again, closer to the mic. ${approx}`;
}

function openaiFeedback(
  verdict: "good" | "needs-work",
  exact: boolean,
  transcript: string,
  reference: string,
  score: number,
): string {
  // `score` is an approximate closeness number (0..100), shown with an "approx."
  // qualifier so we never overclaim it as clinical per-sound accuracy.
  const approx = `(~${score}/100 approx.)`;
  if (verdict === "good") {
    return exact
      ? `Great — that came through clearly as “${reference}”. ${approx}`
      : `Good — close enough to “${reference}” to be understood. ${approx}`;
  }
  if (transcript.trim()) {
    return `That sounded more like “${transcript.trim()}”. Give “${reference}” another go, a little slower. ${approx}`;
  }
  return `I couldn't quite catch that — try saying “${reference}” again, closer to the mic. ${approx}`;
}

function looksLike(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function logFallback(dir: "tts" | "assess", err: unknown): void {
  console.warn(
    `[speech] Azure ${dir} failed, falling back to OpenAI: ${err instanceof Error ? err.message : String(err)}`,
  );
}
