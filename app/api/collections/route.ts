import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { createCollectionSchema, emptySchema } from "@/lib/api-schemas";
import { getStore } from "@/lib/store";

/**
 * GET  -> { collections, memberships, owner }  (collections = the caller's own
 *         PLUS all public ones; `owner` gates the publish toggle in the UI; the
 *         Library page inverts memberships to show per-word chips).
 * POST { name, description?, emoji? } -> { collection }
 */
export const GET = withUser(emptySchema, async ({ userId, owner }) => {
  const store = getStore().forUser(userId);
  const [collections, memberships] = await Promise.all([
    store.collections(),
    store.memberships(),
  ]);
  return NextResponse.json(
    { collections, memberships, owner },
    // Read-mostly JSON: browser-only micro-cache (`private` ⇒ Cloudflare never
    // caches it). Mutations show up within 30s; SWR revalidation still applies.
    { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=300" } },
  );
});

export const POST = withUser(createCollectionSchema, async ({ userId, input }) => {
  const collection = await getStore().forUser(userId).createCollection({
    name: input.name,
    description: input.description,
    emoji: input.emoji,
  });
  return { collection };
});
