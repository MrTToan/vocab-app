import { withOwner } from "@/lib/api";
import { emptySchema } from "@/lib/api-schemas";
import { adminStats } from "@/lib/admin/stats";

/*
 * Owner-only admin metrics. withOwner reuses the app's single identity choke
 * point (currentUserId + the owner check) — no new auth scheme. A signed-in
 * non-owner gets a flat 403 with no data, so the endpoint can never leak
 * another user's activity to a normal account.
 */
export const GET = withOwner(emptySchema, async () => adminStats());
