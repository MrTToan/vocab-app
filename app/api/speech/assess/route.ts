import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { assessSchema } from "@/lib/api-schemas";
import { reserveQuota, isRateLimitError } from "@/lib/auth/quota";
import { speechAvailability, assessPronunciation, SpeechUnavailableError } from "@/lib/speech";

/** WAV MIME types the client may upload. */
export const ALLOWED_AUDIO_TYPES = ["audio/wav", "audio/wave", "audio/x-wav"] as const;
/** Decoded ceiling. A few seconds of 16 kHz mono PCM is well under this. */
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

/**
 * Validate + decode a `data:audio/wav;base64,...` upload. Returns the raw bytes,
 * or a plain-English problem string. Exported for tests.
 */
export function decodeAudio(audio: unknown): { bytes: Uint8Array } | { error: string } {
  if (typeof audio !== "string" || !audio.startsWith("data:")) {
    return { error: "audio (base64 data URL) required" };
  }
  const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(audio.trim());
  if (!m) return { error: "The audio must be a base64 data URL." };
  const mime = m[1].toLowerCase();
  if (!(ALLOWED_AUDIO_TYPES as readonly string[]).includes(mime)) {
    return { error: "Please record WAV audio." };
  }
  const b64 = m[2].replace(/\s+/g, "");
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  const size = Math.floor((b64.length * 3) / 4) - padding;
  if (size <= 44) return { error: "The recording was empty." };
  if (size > MAX_AUDIO_BYTES) return { error: "That recording is too long — keep it under a few seconds." };
  return { bytes: new Uint8Array(Buffer.from(b64, "base64")) };
}

/**
 * POST { word, audio } -> a pronunciation result ("say it").
 *
 * Azure Pronunciation Assessment (real phoneme scoring) when configured/in-
 * budget, else OpenAI Whisper transcription → word-match verdict (see
 * lib/speech). Signed-in + metered (QUOTA_PRONOUNCE); the audio is decoded and
 * WAV-validated before any provider call, and keys never leave the server. When
 * no provider is usable it returns 503 so the UI hides the control.
 */
export const POST = withUser(
  assessSchema,
  async ({ userId, input }) => {
    if (!speechAvailability().assess) {
      return NextResponse.json({ error: "Speech is unavailable right now." }, { status: 503 });
    }
    const decoded = decodeAudio(input.audio);
    if ("error" in decoded) {
      return NextResponse.json({ error: decoded.error }, { status: 400 });
    }
    try {
      await reserveQuota(userId, "pronounce");
      const result = await assessPronunciation(decoded.bytes, input.word);
      return NextResponse.json(result);
    } catch (err: unknown) {
      if (isRateLimitError(err)) {
        return NextResponse.json({ error: err.message }, { status: 429 });
      }
      if (err instanceof SpeechUnavailableError) {
        return NextResponse.json({ error: err.message }, { status: 503 });
      }
      return NextResponse.json(
        { error: `Could not check that: ${err instanceof Error ? err.message : String(err)}` },
        { status: 502 },
      );
    }
  },
  // A few seconds of WAV as a base64 data URL (~1.4 MB encoded per MB decoded).
  { maxBytes: 8 * 1024 * 1024 },
);
