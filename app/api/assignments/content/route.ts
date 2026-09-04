import { NextResponse } from "next/server";
import { withUser, MUTABLE_JSON_CACHE_HEADERS } from "@/lib/api";
import { assignmentContentQuerySchema } from "@/lib/api-schemas";
import { assignmentsStore } from "@/lib/assignments/store";

/**
 * GET ?kind=&q= -> { content } — the teacher's content picker for one kind. The
 * adapter scopes results to the caller's own + public content, so this leaks
 * nothing beyond what the caller can already see. `no-store`.
 * (Static segment; resolves ahead of the dynamic [assignmentId].)
 */
export const GET = withUser(assignmentContentQuerySchema, async ({ userId, input }) => {
  const content = await assignmentsStore.forUser(userId).listPickable(input.kind, input.q ?? "");
  return NextResponse.json({ content }, { headers: MUTABLE_JSON_CACHE_HEADERS });
});
