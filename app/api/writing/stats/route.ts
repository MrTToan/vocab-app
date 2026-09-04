import { withUser } from "@/lib/api";
import { emptySchema } from "@/lib/api-schemas";
import { writingStatsFor } from "@/lib/report-data";

/**
 * Aggregates for the writing side of the cross-skill report. The computation
 * lives in lib/report-data.ts so route 17 (the teacher's read-only view of a
 * student) returns the IDENTICAL shape from the same code.
 */
export const GET = withUser(emptySchema, ({ userId }) => writingStatsFor(userId));
