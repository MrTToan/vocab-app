import { withUser } from "@/lib/api";
import { emptySchema } from "@/lib/api-schemas";
import { vocabStatsFor } from "@/lib/report-data";

/**
 * GET /api/stats — the learner's aggregate numbers for Home + the report page.
 * The aggregates are computed inside the store (in SQL on the SQLite backend;
 * see wordStats/attemptStats in lib/store.ts and the pure reference in
 * lib/stats.ts), so this route never loads every word and attempt into JS.
 * The response shape is byte-compatible with the old in-route computation. The
 * computation lives in lib/report-data.ts so route 17 (the teacher's read-only
 * view of a student) returns the IDENTICAL shape from the same code.
 */
export const GET = withUser(emptySchema, ({ userId }) => vocabStatsFor(userId));
