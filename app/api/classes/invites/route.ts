import { NextResponse } from "next/server";
import { withUser, MUTABLE_JSON_CACHE_HEADERS } from "@/lib/api";
import { emptySchema } from "@/lib/api-schemas";
import { classesStore } from "@/lib/classes/store";

/*
 * Route 11 — GET /api/classes/invites (any signed-in user).
 *
 * Pending invites addressed to the caller's EMAIL → the hub invite banner.
 * Resolving by the account's own email (never a client-supplied one) is the
 * authorization: a user only ever sees invites sent to their address. `no-store`
 * so a post-accept/decline SWR revalidation is never answered stale. The static
 * `invites` segment resolves ahead of the dynamic `[id]`, so this is distinct
 * from GET /api/classes/[id].
 */
export const GET = withUser(emptySchema, async ({ userId }) => {
  const invites = await classesStore.forUser(userId).listInvitesForMe();
  return NextResponse.json({ invites }, { headers: MUTABLE_JSON_CACHE_HEADERS });
});
