import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

/** POST { add?: string[], remove?: string[] } -> { ok }. Bulk add/remove words. */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const { add, remove } = (await req.json()) as {
    add?: string[];
    remove?: string[];
  };
  await getStore().setCollectionMembers(id, {
    add: Array.isArray(add) ? add : [],
    remove: Array.isArray(remove) ? remove : [],
  });
  return NextResponse.json({ ok: true });
}
