import { NextResponse } from "next/server";
import { withUser, MUTABLE_JSON_CACHE_HEADERS } from "@/lib/api";
import { emptySchema } from "@/lib/api-schemas";
import { classesStore } from "@/lib/classes/store";
import { vocabStatsFor, writingStatsFor } from "@/lib/report-data";

/*
 * Route 17 — the trust-critical seam of the Classes feature.
 *
 * GET /api/classes/[id]/students/[studentId]/report
 *   → { vocab: <same shape as /api/stats>,
 *       writing: <same shape as /api/writing/stats>,
 *       student: { name } }
 *
 * This is the ONLY place in the app store.forUser() is called with an id other
 * than the caller's, so a bug here leaks a student's entire practice history.
 * Authorization is `teachesStudent(caller, studentId, classId)` and NOTHING
 * looser: the caller must hold a role='teacher' row AND the target a
 * role='student' row, both in this class. ANY failure — not a teacher here, the
 * target isn't a student here, the class doesn't exist — returns 404 so class or
 * membership existence is never leaked (never 403, which would confirm the class
 * exists). The report is always computed LIVE from the student's data, so
 * removing the membership (leave/remove) revokes this instantly — no snapshot.
 */
export const GET = withUser<typeof emptySchema, { id: string; studentId: string }>(
  emptySchema,
  async ({ userId, params }) => {
    const scope = classesStore.forUser(userId);
    if (!(await scope.teachesStudent(params.id, params.studentId))) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const [vocab, writing, name] = await Promise.all([
      vocabStatsFor(params.studentId),
      writingStatsFor(params.studentId),
      scope.studentName(params.id, params.studentId),
    ]);
    return NextResponse.json(
      { vocab, writing, student: { name } },
      { headers: MUTABLE_JSON_CACHE_HEADERS },
    );
  },
);
