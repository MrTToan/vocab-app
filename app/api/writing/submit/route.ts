import { NextResponse } from "next/server";
import { hasProvider } from "@/lib/providers";
import { writingStore } from "@/lib/writing/store";
import { currentUserId } from "@/lib/auth/user";
import { reserveQuota, QuotaError } from "@/lib/auth/quota";
import { scoreWriting } from "@/lib/writing/score";

/**
 * POST { promptId, text } -> the stored submission with structured feedback:
 * overall band, four criteria bands, located inline corrections, strengths,
 * general feedback. Scored by the LLM, then persisted.
 */
export async function POST(req: Request) {
  if (!hasProvider("score-writing")) {
    return NextResponse.json(
      { error: "AI scoring is not available right now." },
      { status: 400 },
    );
  }

  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const store = writingStore.forUser(userId);

  const { promptId, text } = (await req.json()) as { promptId?: string; text?: string };
  const essay = (text ?? "").trim();
  if (!promptId) return NextResponse.json({ error: "promptId required" }, { status: 400 });
  if (essay.length < 20) {
    return NextResponse.json({ error: "Please write a full response before submitting." }, { status: 400 });
  }

  const prompt = await store.getPrompt(promptId);
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
  } catch (err: any) {
    if (err instanceof QuotaError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return NextResponse.json(
      { error: `Scoring failed: ${err?.message ?? err}` },
      { status: 502 },
    );
  }
}
