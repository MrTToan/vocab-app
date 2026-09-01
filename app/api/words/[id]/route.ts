import { NextResponse } from "next/server";
import { getStore, ForbiddenError } from "@/lib/store";
import { currentUserId } from "@/lib/auth/user";
import type { Word } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const patch = (await req.json()) as Partial<Word>;
  // never let the client rewrite identity or ownership
  delete (patch as any).id;
  delete (patch as any).created_at;
  delete (patch as any).owner_id;
  try {
    const updated = await getStore().forUser(userId).update(id, patch);
    if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ word: updated });
  } catch (e) {
    if (e instanceof ForbiddenError)
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await getStore().forUser(userId).remove(id);
  return NextResponse.json({ ok: true });
}
