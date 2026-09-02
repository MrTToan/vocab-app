import { withUser } from "@/lib/api";
import { submissionQuerySchema } from "@/lib/api-schemas";
import { writingStore } from "@/lib/writing/store";

/**
 * GET /api/writing/submission?promptId=X -> { submission } — the most recent
 * scored submission for a prompt (with corrections), so a learner can review
 * their last feedback without re-writing. `submission` is null if never done.
 */
export const GET = withUser(submissionQuerySchema, async ({ userId, input }) => {
  const submission = await writingStore.forUser(userId).latestSubmission(input.promptId);
  return { submission };
});
