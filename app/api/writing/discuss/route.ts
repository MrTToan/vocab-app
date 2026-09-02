import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { discussPostSchema, discussQuerySchema } from "@/lib/api-schemas";
import { hasProvider } from "@/lib/providers";
import { writingStore } from "@/lib/writing/store";
import { discussCard } from "@/lib/writing/discuss";
import { reserveQuota, isRateLimitError } from "@/lib/auth/quota";

/** Longest question a student can send in one turn (also capped in the schema). */
export const MAX_MESSAGE_CHARS = 1000;

/**
 * GET  /api/writing/discuss?submissionId=..  -> { messages: [...] }  (all cards)
 * POST { submissionId, cardKey, message }     -> { messages: [...] }  (that card's full thread)
 *
 * A per-feedback-card Q&A thread. The card's context is resolved server-side from
 * the stored submission, so the client only sends which card + the question.
 * POST is metered (QUOTA_DISCUSS + burst window) and the message is length-capped.
 */
export const GET = withUser(discussQuerySchema, async ({ userId, input }) => {
  // Verify the submission belongs to the caller before exposing its thread.
  const owned = await writingStore.getSubmission(userId, input.submissionId);
  if (!owned) return NextResponse.json({ error: "submission not found" }, { status: 404 });
  const messages = await writingStore.listDiscussion(input.submissionId);
  return NextResponse.json({ messages });
});

export const POST = withUser(discussPostSchema, async ({ userId, input }) => {
  if (!hasProvider("discuss-writing")) {
    return NextResponse.json(
      { error: "AI discussion is not available right now." },
      { status: 400 },
    );
  }

  const { submissionId, cardKey } = input;
  const question = (input.message ?? "").trim();
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
    await reserveQuota(userId, "discuss-writing");
    const reply = await discussCard(prompt, submission, cardKey, history, question);
    const messages = await writingStore.addDiscussionMessages(submissionId, cardKey, [
      { role: "user", content: question },
      { role: "assistant", content: reply },
    ]);
    return NextResponse.json({ messages });
  } catch (err: unknown) {
    if (isRateLimitError(err)) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return NextResponse.json(
      { error: `Couldn't get an answer: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
});
