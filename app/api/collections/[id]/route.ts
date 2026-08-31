import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { currentUserId } from "@/lib/auth/user";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH { name?, description?, emoji? } -> { collection } */
export async function PATCH(req: Request, ctx: Ctx) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const patch = (await req.json()) as {
    name?: string;
    description?: string;
    emoji?: string;
  };
  const updated = await getStore().forUser(userId).updateCollection(id, patch);
  if (!updated)
    return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ collection: updated });
}

/** DELETE -> { ok }. Removes the collection and all its word links (words kept). */
export async function DELETE(_req: Request, ctx: Ctx) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  await getStore().forUser(userId).removeCollection(id);
  return NextResponse.json({ ok: true });
}
