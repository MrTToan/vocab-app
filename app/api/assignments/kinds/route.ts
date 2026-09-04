import { NextResponse } from "next/server";
import { withUser, MUTABLE_JSON_CACHE_HEADERS } from "@/lib/api";
import { emptySchema } from "@/lib/api-schemas";
import { kindTabs } from "@/lib/assignments/kinds";

/**
 * GET -> { kinds } — the assignable content kinds (registry-driven), for the
 * picker's tab strip. Adding a kind lights up a new tab with no route change.
 * (Static segment; resolves ahead of the dynamic [assignmentId].)
 */
export const GET = withUser(emptySchema, async () => {
  return NextResponse.json({ kinds: kindTabs() }, { headers: MUTABLE_JSON_CACHE_HEADERS });
});
