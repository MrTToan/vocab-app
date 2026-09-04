import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { emptySchema } from "@/lib/api-schemas";
import { classesStore } from "@/lib/classes/store";

/*
 * Route 10 — DELETE /api/classes/[id]/invites/[inviteId] (teacher only).
 * Revoke a pending invite (its accept link stops working). Idempotent: revoking
 * an already-resolved or unknown invite is a benign no-op.
 */
export const DELETE = withUser<typeof emptySchema, { id: string; inviteId: string }>(
  emptySchema,
  async ({ userId, params }) => {
    await classesStore.forUser(userId).revokeInvite(params.id, params.inviteId);
    return NextResponse.json({ ok: true });
  },
);
