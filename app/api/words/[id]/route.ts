import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { currentUserId } from "@/lib/auth/user";
import type { Word } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const patch = (await req.json()) as Partial<Word>;
  // never let the client rewrite identity
  delete (patch as any).id;
  delete (patch as any).created_at;
  const updated = await getStore().forUser(userId).update(id, patch);
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ word: updated });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await getStore().forUser(userId).remove(id);
  return NextResponse.json({ ok: true });
}
