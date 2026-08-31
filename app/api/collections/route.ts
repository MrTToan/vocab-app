import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { currentUserId } from "@/lib/auth/user";

/**
 * GET  -> { collections, memberships }  (both small; the Library page inverts
 *         memberships to show per-word chips).
 * POST { name, description?, emoji? } -> { collection }
 */
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const store = getStore().forUser(userId);
  const [collections, memberships] = await Promise.all([
    store.collections(),
    store.memberships(),
  ]);
  return NextResponse.json({ collections, memberships });
}

export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json()) as {
    name?: string;
    description?: string;
    emoji?: string;
  };
  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const collection = await getStore().forUser(userId).createCollection({
    name,
    description: body.description,
    emoji: body.emoji,
  });
  return NextResponse.json({ collection });
}
