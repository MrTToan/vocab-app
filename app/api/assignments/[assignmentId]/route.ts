import { NextResponse } from "next/server";
import { withUser, MUTABLE_JSON_CACHE_HEADERS } from "@/lib/api";
import { emptySchema, patchAssignmentSchema } from "@/lib/api-schemas";
import { assignmentsStore } from "@/lib/assignments/store";

/**
 * GET    -> role-shaped detail. Teacher of the class: the per-student completion
 *           grid (targeted students still in the class). A targeted student: their
 *           own card + progress. Anyone else (non-member, member-but-not-a-target,
 *           archived) -> 404 (existence not leaked). `no-store`.
 * PATCH { title?, instructions?, dueAt? } -> { assignment }. Teacher-only (403 else).
 * DELETE -> { ok }. Soft-archive (teacher-only) — revokes any granted practice access.
 */
export const GET = withUser<typeof emptySchema, { assignmentId: string }>(
  emptySchema,
  async ({ userId, params }) => {
    const detail = await assignmentsStore.forUser(userId).getDetail(params.assignmentId);
    if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(detail, { headers: MUTABLE_JSON_CACHE_HEADERS });
  },
);

export const PATCH = withUser<typeof patchAssignmentSchema, { assignmentId: string }>(
  patchAssignmentSchema,
  async ({ userId, input, params }) => {
    const updated = await assignmentsStore.forUser(userId).updateAssignment(params.assignmentId, {
      title: input.title,
      instructions: input.instructions,
      dueAt: input.dueAt,
    });
    if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
    return { assignment: updated };
  },
);

export const DELETE = withUser<typeof emptySchema, { assignmentId: string }>(
  emptySchema,
  async ({ userId, params }) => {
    await assignmentsStore.forUser(userId).archiveAssignment(params.assignmentId);
    return NextResponse.json({ ok: true });
  },
);
