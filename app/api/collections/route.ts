import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";

/**
 * GET  -> { collections, memberships }  (both small; the Library page inverts
 *         memberships to show per-word chips).
 * POST { name, description?, emoji? } -> { collection }
 */
export async function GET() {
  const store = getStore();
  const [collections, memberships] = await Promise.all([
    store.collections(),
    store.memberships(),
  ]);
  return NextResponse.json({ collections, memberships });
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    name?: string;
    description?: string;
    emoji?: string;
  };
  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const collection = await getStore().createCollection({
    name,
    description: body.description,
    emoji: body.emoji,
  });
  return NextResponse.json({ collection });
}
