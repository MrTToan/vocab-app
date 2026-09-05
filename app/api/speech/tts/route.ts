import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { speakSchema } from "@/lib/api-schemas";
import { reserveQuota, isRateLimitError } from "@/lib/auth/quota";
import { speechAvailability, synthesizeSpeech, SpeechUnavailableError } from "@/lib/speech";

/**
 * POST { word, example? } -> the spoken audio ("hear it").
 *
 * Azure Neural TTS when configured/in-budget, else OpenAI TTS (see lib/speech).
 * Signed-in + metered (QUOTA_SPEAK). Returns the audio bytes directly so the
 * client can play them straight from an <audio> element; keys never leave the
 * server. When no provider is usable it returns 503 so the UI hides the control.
 *
 * We synthesize ONLY the target word — the learner wants to hear the word
 * pronounced, not the whole example sentence. `example` stays in the schema for
 * back-compat but is intentionally not spoken.
 */
export const POST = withUser(speakSchema, async ({ userId, input }) => {
  if (!speechAvailability().tts) {
    return NextResponse.json({ error: "Speech is unavailable right now." }, { status: 503 });
  }
  // Speak just the word (never the example sentence).
  const text = input.word;
  try {
    await reserveQuota(userId, "speak");
    const { audio, mime } = await synthesizeSpeech(text);
    return new NextResponse(audio as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(audio.byteLength),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err: unknown) {
    if (isRateLimitError(err)) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    if (err instanceof SpeechUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: `Could not play that: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
});
