import { NextResponse } from "next/server";
import { withUser, MUTABLE_JSON_CACHE_HEADERS } from "@/lib/api";
import { emptySchema, patchClassSchema } from "@/lib/api-schemas";
import { classesStore } from "@/lib/classes/store";

/**
 * GET -> the class detail, member-gated. A non-member gets 404 (existence is
 *        NOT leaked). Teacher payload = roster + join code; student payload =
 *        class + teacher(s) + the trust notice.
 */
export const GET = withUser<typeof emptySchema, { id: string }>(
  emptySchema,
  async ({ userId, params }) => {
    const detail = await classesStore.forUser(userId).getDetail(params.id);
    if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(detail, { headers: MUTABLE_JSON_CACHE_HEADERS });
  },
);

/** PATCH { name?, description?, emoji? } -> { class }. Teacher-only (403 else). */
export const PATCH = withUser<typeof patchClassSchema, { id: string }>(
  patchClassSchema,
  async ({ userId, input, params }) => {
    const updated = await classesStore.forUser(userId).updateClass(params.id, input);
    if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ class: updated });
  },
);

/** DELETE -> { ok }. Soft-archive (creator only); the class + reports go inert. */
export const DELETE = withUser<typeof emptySchema, { id: string }>(
  emptySchema,
  async ({ userId, params }) => {
    await classesStore.forUser(userId).archiveClass(params.id);
    return NextResponse.json({ ok: true });
  },
);
