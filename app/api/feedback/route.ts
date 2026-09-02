import { withOwner, withUser } from "@/lib/api";
import { createFeedbackSchema, emptySchema } from "@/lib/api-schemas";
import { feedbackStore } from "@/lib/feedback/store";

/*
 * POST /api/feedback — submit one feedback entry. Sign-in gated (withUser →
 * 401 when signed out), origin-checked, zod-validated. The message is required;
 * category defaults to "other"; the star rating is optional. `page` (where the
 * widget was opened) comes from the body; the User-Agent is captured here,
 * server-side, so it can't be spoofed by the payload.
 *
 * GET /api/feedback — owner-only (withOwner → 403 otherwise): every submission,
 * newest first, for the admin "Feedback" subtab.
 */

export const POST = withUser(createFeedbackSchema, async ({ userId, input, req }) => {
  const userAgent = (req.headers.get("user-agent") ?? "").slice(0, 512);
  await feedbackStore.forUser(userId).add({
    category: input.category,
    rating: input.rating ?? null,
    message: input.message,
    page: input.page ?? "",
    user_agent: userAgent,
  });
  return { ok: true };
});

export const GET = withOwner(emptySchema, async () => ({
  feedback: await feedbackStore.listAll(),
}));
