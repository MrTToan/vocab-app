import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { emptySchema, patchCollectionSchema } from "@/lib/api-schemas";
import { getStore } from "@/lib/store";

/** PATCH { name?, description?, emoji?, visibility? } -> { collection }.
 *  Editing (and flipping visibility) is owner-gated; a non-owner gets 403 (the
 *  wrapper maps the store's ForbiddenError). */
export const PATCH = withUser<typeof patchCollectionSchema, { id: string }>(
  patchCollectionSchema,
  async ({ userId, input, params }) => {
    const store = getStore().forUser(userId);
    let updated;
    if (input.visibility === "public" || input.visibility === "private") {
      updated = await store.setCollectionVisibility(params.id, input.visibility);
    }
    if (
      input.name !== undefined ||
      input.description !== undefined ||
      input.emoji !== undefined
    ) {
      updated = await store.updateCollection(params.id, input);
    }
    if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ collection: updated });
  },
);

/** DELETE -> { ok }. Removes the collection and all its word links (words kept). */
export const DELETE = withUser<typeof emptySchema, { id: string }>(
  emptySchema,
  async ({ userId, params }) => {
    await getStore().forUser(userId).removeCollection(params.id);
    return NextResponse.json({ ok: true });
  },
);
