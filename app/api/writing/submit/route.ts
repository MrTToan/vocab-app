import { NextResponse } from "next/server";
import { hasProvider } from "@/lib/providers";
import { writingStore } from "@/lib/writing/store";
import { scoreWriting } from "@/lib/writing/score";

/**
 * POST { promptId, text } -> the stored submission with structured feedback:
 * overall band, four criteria bands, located inline corrections, strengths,
 * general feedback. Scored by the LLM, then persisted.
 */
export async function POST(req: Request) {
  if (!hasProvider("score-writing")) {
    return NextResponse.json(
      { error: "No LLM configured for scoring. See docs/SETUP-LLM-PROVIDERS.md." },
      { status: 400 },
    );
  }

  const { promptId, text } = (await req.json()) as { promptId?: string; text?: string };
  const essay = (text ?? "").trim();
  if (!promptId) return NextResponse.json({ error: "promptId required" }, { status: 400 });
  if (essay.length < 20) {
    return NextResponse.json({ error: "Please write a full response before submitting." }, { status: 400 });
  }

  const prompt = await writingStore.getPrompt(promptId);
  if (!prompt) return NextResponse.json({ error: "prompt not found" }, { status: 404 });

  try {
    const scored = await scoreWriting(prompt, essay);
    const submission = await writingStore.addSubmission({
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
    return NextResponse.json(
      { error: `Scoring failed: ${err?.message ?? err}` },
      { status: 502 },
    );
  }
}
