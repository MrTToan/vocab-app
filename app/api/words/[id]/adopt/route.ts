import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { emptySchema } from "@/lib/api-schemas";
import { getStore } from "@/lib/store";

/**
 * POST /api/words/:id/adopt -> { adopted: true }.
 * Start studying one visible word (a public-catalog word, or the caller's own):
 * creates this user's `user_words` progress row (stage `new`) if absent. No
 * content is copied — the word stays shared. Idempotent. Per-word twin of
 * /api/collections/:id/adopt; used by the Library collection filter's
 * "add to my studying" action on not-yet-studied members. 404 when the word is
 * missing or not visible to the caller (never leaks another user's private word).
 */
export const POST = withUser<typeof emptySchema, { id: string }>(
  emptySchema,
  async ({ userId, params }) => {
    const ok = await getStore().forUser(userId).adoptWord(params.id);
    if (!ok) {
      return NextResponse.json(
        { error: "unknown or inaccessible word id" },
        { status: 404 },
      );
    }
    return { adopted: true };
  },
);
