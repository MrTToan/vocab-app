import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { currentUserId } from "@/lib/auth/user";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/collections/:id/adopt -> { adopted }.
 * Bulk-adopt a (visible) collection: create this user's `user_words` progress
 * rows for every member word so the whole set enters their study rotation. No
 * content is copied — the words stay shared. Idempotent (INSERT OR IGNORE).
 */
export async function POST(_req: Request, ctx: Ctx) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const adopted = await getStore().forUser(userId).adoptCollection(id);
  return NextResponse.json({ adopted });
}
