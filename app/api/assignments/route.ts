import { NextResponse } from "next/server";
import { withUser, MUTABLE_JSON_CACHE_HEADERS } from "@/lib/api";
import { emptySchema } from "@/lib/api-schemas";
import { assignmentsStore } from "@/lib/assignments/store";

/**
 * GET -> { assignments } — the caller's OWN open assignments across every class
 *        they're a student in (the /classes hub roll-up), each with its resolved
 *        content card + the caller's own progress + overdue flag. `no-store`.
 */
export const GET = withUser(emptySchema, async ({ userId }) => {
  const assignments = await assignmentsStore.forUser(userId).listMine();
  return NextResponse.json({ assignments }, { headers: MUTABLE_JSON_CACHE_HEADERS });
});
