import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { emptySchema } from "@/lib/api-schemas";
import { classesStore } from "@/lib/classes/store";

/*
 * Route 12 — POST /api/classes/invites/[inviteId]/accept (any signed-in user).
 *
 * The CONSENT write for the email-invite path: the client only POSTs here after
 * the SAME consent screen as the code-join (the whole-report warning). The
 * caller's account email MUST match the invite (else 404 — an invite's existence
 * is not leaked to anyone but its recipient, and there is NO silent auto-join).
 * A seat is taken with the same last-seat-guarded insert as join-by-code
 * (joined_via='invite'); over-cap → ClassCapError (→ 409), and the invite stays
 * pending. On success the invite is marked accepted. The accept-link landing
 * (`/classes?invite=<token>`) resolves to this exact flow.
 */
export const POST = withUser<typeof emptySchema, { inviteId: string }>(
  emptySchema,
  async ({ userId, params }) => {
    const result = await classesStore.forUser(userId).acceptInvite(params.inviteId);
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ class: result.class, status: result.status });
  },
);
