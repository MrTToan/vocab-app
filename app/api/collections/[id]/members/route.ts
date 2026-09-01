import { NextResponse } from "next/server";
import { getStore, ForbiddenError } from "@/lib/store";
import { currentUserId } from "@/lib/auth/user";

type Ctx = { params: Promise<{ id: string }> };

/** POST { add?: string[], remove?: string[] } -> { ok }. Bulk add/remove words.
 *  Only the collection's owner may change membership (non-owner gets 403). */
export async function POST(req: Request, ctx: Ctx) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const { add, remove } = (await req.json()) as {
    add?: string[];
    remove?: string[];
  };
  try {
    await getStore().forUser(userId).setCollectionMembers(id, {
      add: Array.isArray(add) ? add : [],
      remove: Array.isArray(remove) ? remove : [],
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ForbiddenError)
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }
}
