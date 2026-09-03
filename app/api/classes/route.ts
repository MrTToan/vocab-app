import { NextResponse } from "next/server";
import { withUser, MUTABLE_JSON_CACHE_HEADERS } from "@/lib/api";
import { createClassSchema, emptySchema } from "@/lib/api-schemas";
import { classesStore } from "@/lib/classes/store";

/**
 * GET  -> { teaching:[{...,studentCount}], enrolled:[{...,teacherNames}], invites }
 *         Only classes the caller is a member of, split by their per-class role.
 *         `invites` is [] in Slice 1 (email invites are a later slice).
 * POST { name, description?, emoji? } -> { class }. The creator becomes the
 *         class's teacher; the classes-per-teacher + memberships caps are
 *         enforced in the store (over-cap -> 409).
 */
export const GET = withUser(emptySchema, async ({ userId }) => {
  const data = await classesStore.forUser(userId).listMine();
  // Mutable per-user data: `no-store` so a post-mutation SWR revalidation is
  // never answered stale from the browser cache (see MUTABLE_JSON_CACHE_HEADERS).
  return NextResponse.json(data, { headers: MUTABLE_JSON_CACHE_HEADERS });
});

export const POST = withUser(createClassSchema, async ({ userId, input }) => {
  const cls = await classesStore.forUser(userId).createClass({
    name: input.name,
    description: input.description,
    emoji: input.emoji,
  });
  return { class: cls };
});
