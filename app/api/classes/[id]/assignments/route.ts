import { NextResponse } from "next/server";
import { withUser, MUTABLE_JSON_CACHE_HEADERS } from "@/lib/api";
import { createAssignmentSchema, emptySchema } from "@/lib/api-schemas";
import { assignmentsStore } from "@/lib/assignments/store";

/**
 * GET  -> role-shaped assignments for the class (teacher: each assignment + its
 *         resolved content card + completion summary; student: their targeted
 *         assignments + card + own progress). Non-member -> 404 (existence not
 *         leaked). `no-store` (mutable per-user data).
 * POST { kind, ref, title?, instructions?, dueAt?, studentIds[] } -> { assignment }.
 *         Teacher-only (store); bad content ref / no valid students -> 400;
 *         over the per-class cap -> 409.
 */
export const GET = withUser<typeof emptySchema, { id: string }>(
  emptySchema,
  async ({ userId, params }) => {
    const data = await assignmentsStore.forUser(userId).listForClass(params.id);
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(data, { headers: MUTABLE_JSON_CACHE_HEADERS });
  },
);

export const POST = withUser<typeof createAssignmentSchema, { id: string }>(
  createAssignmentSchema,
  async ({ userId, input, params }) => {
    const assignment = await assignmentsStore.forUser(userId).createAssignment(params.id, {
      kind: input.kind,
      ref: input.ref,
      title: input.title,
      instructions: input.instructions,
      dueAt: input.dueAt ?? null,
      studentIds: input.studentIds,
    });
    return { assignment };
  },
);
