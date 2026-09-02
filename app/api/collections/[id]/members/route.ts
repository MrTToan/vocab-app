import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { collectionMembersSchema } from "@/lib/api-schemas";
import { getStore } from "@/lib/store";

/** POST { add?: string[], remove?: string[] } -> { ok }. Bulk add/remove words.
 *  Only the collection's owner may change membership (non-owner gets 403 via
 *  the wrapper's ForbiddenError mapping). Added ids must reference words the
 *  caller can SEE (public catalog or their own) — unknown/foreign ids -> 400. */
export const POST = withUser<typeof collectionMembersSchema, { id: string }>(
  collectionMembersSchema,
  async ({ userId, input, params }) => {
    const store = getStore().forUser(userId);
    const add = input.add ?? [];
    // Verify every added word exists and is visible to the caller before any
    // insert — the join table must never gain rows pointing at invisible words.
    for (const wordId of add) {
      if (!(await store.get(wordId))) {
        return NextResponse.json(
          { error: "unknown or inaccessible word id" },
          { status: 400 },
        );
      }
    }
    await store.setCollectionMembers(params.id, {
      add,
      remove: input.remove ?? [],
    });
    return NextResponse.json({ ok: true });
  },
);
