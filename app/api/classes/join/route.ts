import { NextResponse } from "next/server";
import { withUser, MUTABLE_JSON_CACHE_HEADERS } from "@/lib/api";
import { joinClassSchema, joinCodeQuerySchema } from "@/lib/api-schemas";
import { classesStore, normalizeJoinCode } from "@/lib/classes/store";

/**
 * GET ?code=… -> the consent-screen preview: { class:{id,name,emoji},
 *   teacher:{name}, consent }. NO write. 404 on a bad/disabled code. This is
 *   what the shared consent screen (§5.3) reads before any join.
 */
export const GET = withUser(joinCodeQuerySchema, async ({ userId, input }) => {
  const preview = await classesStore
    .forUser(userId)
    .joinPreview(normalizeJoinCode(input.code));
  if (!preview) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(preview, { headers: MUTABLE_JSON_CACHE_HEADERS });
});

/**
 * POST { code } -> { class, status }. The CONSENT write: takes a seat-guarded
 * student membership. 404 bad code · 409 full (or memberships cap) · 200
 * joined/already-member (re-joining is benign, never a duplicate).
 */
export const POST = withUser(joinClassSchema, async ({ userId, input }) => {
  const result = await classesStore
    .forUser(userId)
    .joinByCode(normalizeJoinCode(input.code));
  if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ class: result.class, status: result.status });
});
