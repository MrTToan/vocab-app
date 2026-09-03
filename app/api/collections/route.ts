import { NextResponse } from "next/server";
import { withUser, MUTABLE_JSON_CACHE_HEADERS } from "@/lib/api";
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
    // Mutable per-user data: `no-store` so a post-mutation SWR revalidation is
    // never answered stale from the browser cache (see MUTABLE_JSON_CACHE_HEADERS).
    { headers: MUTABLE_JSON_CACHE_HEADERS },
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
