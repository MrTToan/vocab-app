import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { emptySchema } from "@/lib/api-schemas";
import { classesStore } from "@/lib/classes/store";

/** DELETE -> { ok }. Teacher-only. Removes the student's membership, which
 *  revokes the teacher's report visibility immediately. */
export const DELETE = withUser<typeof emptySchema, { id: string; studentId: string }>(
  emptySchema,
  async ({ userId, params }) => {
    await classesStore.forUser(userId).removeStudent(params.id, params.studentId);
    return NextResponse.json({ ok: true });
  },
);
