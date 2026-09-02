import { withUser } from "@/lib/api";
import { emptySchema } from "@/lib/api-schemas";
import { getStore } from "@/lib/store";

/**
 * POST /api/collections/:id/adopt -> { adopted }.
 * Bulk-adopt a (visible) collection: create this user's `user_words` progress
 * rows for every member word so the whole set enters their study rotation. No
 * content is copied — the words stay shared. Idempotent (INSERT OR IGNORE).
 */
export const POST = withUser<typeof emptySchema, { id: string }>(
  emptySchema,
  async ({ userId, params }) => ({
    adopted: await getStore().forUser(userId).adoptCollection(params.id),
  }),
);
