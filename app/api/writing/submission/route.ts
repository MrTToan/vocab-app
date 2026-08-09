import { NextResponse } from "next/server";
import { writingStore } from "@/lib/writing/store";

/**
 * GET /api/writing/submission?promptId=X -> { submission } — the most recent
 * scored submission for a prompt (with corrections), so a learner can review
 * their last feedback without re-writing. `submission` is null if never done.
 */
export async function GET(req: Request) {
  const promptId = new URL(req.url).searchParams.get("promptId");
  if (!promptId) return NextResponse.json({ error: "promptId required" }, { status: 400 });
  const submission = await writingStore.latestSubmission(promptId);
  return NextResponse.json({ submission });
}
