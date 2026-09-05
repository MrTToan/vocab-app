/*
 * OpenAI speech backend (the FALLBACK path) — raw `fetch`, no SDK, matching the
 * house style for provider calls (lib/providers.ts, lib/email/send.ts).
 *
 *   - "hear it" → POST /audio/speech        (TTS, returns MP3 bytes)
 *   - "say it"  → POST /audio/transcriptions (Whisper, returns { text })
 *
 * Whisper only TRANSCRIBES — the caller turns the text into a word-match verdict
 * (lib/speech/match.ts). This is not phoneme scoring; that's Azure-only.
 *
 * Credentials come from the existing LLM chain (config.ts resolveOpenAI); no new
 * key mechanism. Keys never leave the server.
 */

import { resolveOpenAI, openAiTtsModel, openAiTtsVoice, openAiSttModel, speechTimeoutMs } from "./config";
import type { TtsResult } from "./types";

class OpenAiSpeechError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "OpenAiSpeechError";
  }
}

/** Synthesize `text` to MP3 via OpenAI TTS. Throws on any non-2xx / network error. */
export async function openaiTts(text: string): Promise<TtsResult> {
  const cfg = resolveOpenAI();
  if (!cfg) throw new OpenAiSpeechError("OpenAI is not configured");
  const res = await fetch(`${cfg.baseUrl}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: openAiTtsModel(),
      voice: openAiTtsVoice(),
      input: text,
      response_format: "mp3",
    }),
    signal: AbortSignal.timeout(speechTimeoutMs()),
  });
  if (!res.ok) {
    throw new OpenAiSpeechError(`OpenAI TTS HTTP ${res.status}: ${(await safeText(res)).slice(0, 200)}`, res.status);
  }
  const audio = new Uint8Array(await res.arrayBuffer());
  return { provider: "openai", audio, mime: "audio/mpeg" };
}

/** Transcribe a WAV clip via Whisper. Returns the recognized text (may be ""). */
export async function openaiTranscribe(wav: Uint8Array): Promise<string> {
  const cfg = resolveOpenAI();
  if (!cfg) throw new OpenAiSpeechError("OpenAI is not configured");
  const form = new FormData();
  // A fresh ArrayBuffer copy keeps Blob happy regardless of the view's offset.
  const buf = wav.slice().buffer;
  form.append("file", new Blob([buf], { type: "audio/wav" }), "speech.wav");
  form.append("model", openAiSttModel());
  form.append("language", "en");
  form.append("response_format", "json");
  const res = await fetch(`${cfg.baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}` }, // let fetch set the multipart boundary
    body: form,
    signal: AbortSignal.timeout(speechTimeoutMs()),
  });
  if (!res.ok) {
    throw new OpenAiSpeechError(`OpenAI transcription HTTP ${res.status}: ${(await safeText(res)).slice(0, 200)}`, res.status);
  }
  const json = (await res.json()) as { text?: unknown };
  return typeof json.text === "string" ? json.text : "";
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
