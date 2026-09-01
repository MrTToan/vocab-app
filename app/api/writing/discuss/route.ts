import { NextResponse } from "next/server";
import { hasProvider } from "@/lib/providers";
import { writingStore } from "@/lib/writing/store";
import { discussCard } from "@/lib/writing/discuss";
import { currentUserId } from "@/lib/auth/user";

/**
 * GET  /api/writing/discuss?submissionId=..  -> { messages: [...] }  (all cards)
 * POST { submissionId, cardKey, message }     -> { messages: [...] }  (that card's full thread)
 *
 * A per-feedback-card Q&A thread. The card's context is resolved server-side from
 * the stored submission, so the client only sends which card + the question.
 */
export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const submissionId = new URL(req.url).searchParams.get("submissionId") ?? "";
  if (!submissionId) return NextResponse.json({ error: "submissionId required" }, { status: 400 });
  // Verify the submission belongs to the caller before exposing its thread.
  const owned = await writingStore.getSubmission(userId, submissionId);
  if (!owned) return NextResponse.json({ error: "submission not found" }, { status: 404 });
  const messages = await writingStore.listDiscussion(submissionId);
  return NextResponse.json({ messages });
}

export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasProvider("discuss-writing")) {
    return NextResponse.json(
      { error: "AI discussion is not available right now." },
      { status: 400 },
    );
  }

  const { submissionId, cardKey, message } = (await req.json()) as {
    submissionId?: string;
    cardKey?: string;
    message?: string;
  };
  const question = (message ?? "").trim();
  if (!submissionId || !cardKey) {
    return NextResponse.json({ error: "submissionId and cardKey required" }, { status: 400 });
  }
  if (question.length < 2) {
    return NextResponse.json({ error: "Please type a question." }, { status: 400 });
  }

  const submission = await writingStore.getSubmission(userId, submissionId);
  if (!submission) return NextResponse.json({ error: "submission not found" }, { status: 404 });
  const prompt = await writingStore.forUser(userId).getPrompt(submission.prompt_id);
  if (!prompt) return NextResponse.json({ error: "prompt not found" }, { status: 404 });

  // Prior turns for THIS card, in order (used as conversation context).
  const all = await writingStore.listDiscussion(submissionId);
  const history = all.filter((m) => m.card_key === cardKey).sort((a, b) => a.seq - b.seq);

  try {
    const reply = await discussCard(prompt, submission, cardKey, history, question);
    const messages = await writingStore.addDiscussionMessages(submissionId, cardKey, [
      { role: "user", content: question },
      { role: "assistant", content: reply },
    ]);
    return NextResponse.json({ messages });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Couldn't get an answer: ${err?.message ?? err}` },
      { status: 502 },
    );
  }
}
