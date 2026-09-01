import { NextResponse } from "next/server";
import { getStore, ForbiddenError } from "@/lib/store";
import { currentUserId } from "@/lib/auth/user";
import type { Visibility } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH { name?, description?, emoji?, visibility? } -> { collection }.
 *  Editing (and flipping visibility) is owner-gated; a non-owner gets 403. */
export async function PATCH(req: Request, ctx: Ctx) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const patch = (await req.json()) as {
    name?: string;
    description?: string;
    emoji?: string;
    visibility?: Visibility;
  };
  const store = getStore().forUser(userId);
  try {
    let updated;
    if (patch.visibility === "public" || patch.visibility === "private") {
      updated = await store.setCollectionVisibility(id, patch.visibility);
    }
    if (
      patch.name !== undefined ||
      patch.description !== undefined ||
      patch.emoji !== undefined
    ) {
      updated = await store.updateCollection(id, patch);
    }
    if (!updated)
      return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ collection: updated });
  } catch (e) {
    if (e instanceof ForbiddenError)
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }
}

/** DELETE -> { ok }. Removes the collection and all its word links (words kept). */
export async function DELETE(_req: Request, ctx: Ctx) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    await getStore().forUser(userId).removeCollection(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ForbiddenError)
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }
}
