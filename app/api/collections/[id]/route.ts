import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH { name?, description?, emoji? } -> { collection } */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const patch = (await req.json()) as {
    name?: string;
    description?: string;
    emoji?: string;
  };
  const updated = await getStore().updateCollection(id, patch);
  if (!updated)
    return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ collection: updated });
}

/** DELETE -> { ok }. Removes the collection and all its word links (words kept). */
export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  await getStore().removeCollection(id);
  return NextResponse.json({ ok: true });
}
