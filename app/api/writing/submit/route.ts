import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { writingSubmitSchema } from "@/lib/api-schemas";
import { hasProvider } from "@/lib/providers";
import { writingStore } from "@/lib/writing/store";
import { reserveQuota, isRateLimitError } from "@/lib/auth/quota";
import { scoreWriting } from "@/lib/writing/score";

/**
 * POST { promptId, text } -> the stored submission with structured feedback:
 * overall band, four criteria bands, located inline corrections, strengths,
 * general feedback. Scored by the LLM, then persisted. Essays are capped at
 * 8,000 characters by the schema.
 */
export const POST = withUser(writingSubmitSchema, async ({ userId, input }) => {
  if (!hasProvider("score-writing")) {
    return NextResponse.json(
      { error: "AI scoring is not available right now." },
      { status: 400 },
    );
  }

  const store = writingStore.forUser(userId);
  const essay = (input.text ?? "").trim();
  if (essay.length < 20) {
    return NextResponse.json({ error: "Please write a full response before submitting." }, { status: 400 });
  }

  const prompt = await store.getPrompt(input.promptId);
  if (!prompt) return NextResponse.json({ error: "prompt not found" }, { status: 404 });

  try {
    await reserveQuota(userId, "score-writing");
    const scored = await scoreWriting(prompt, essay);
    const submission = await store.addSubmission({
      prompt_id: prompt.id,
      task_type: prompt.task_type,
      text: essay,
      word_count: scored.wordCount,
      overall_band: scored.overall_band,
      bands: scored.bands,
      strengths: scored.strengths,
      general_feedback: scored.general_feedback,
      priorities: scored.priorities,
      corrections: scored.corrections,
    });
    return NextResponse.json({ submission });
  } catch (err: unknown) {
    if (isRateLimitError(err)) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return NextResponse.json(
      { error: `Scoring failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
});
