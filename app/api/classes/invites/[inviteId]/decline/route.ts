import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { emptySchema } from "@/lib/api-schemas";
import { classesStore } from "@/lib/classes/store";

/*
 * Route 13 — POST /api/classes/invites/[inviteId]/decline (any signed-in user).
 * The invited user marks their own invite `declined`. Email-matched (else 404,
 * same non-leak rule as accept). No membership is created.
 */
export const POST = withUser<typeof emptySchema, { inviteId: string }>(
  emptySchema,
  async ({ userId, params }) => {
    const ok = await classesStore.forUser(userId).declineInvite(params.inviteId);
    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  },
);
