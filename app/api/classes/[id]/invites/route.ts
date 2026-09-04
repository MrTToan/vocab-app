import { NextResponse } from "next/server";
import { withUser, MUTABLE_JSON_CACHE_HEADERS } from "@/lib/api";
import { createInvitesSchema } from "@/lib/api-schemas";
import { classesStore } from "@/lib/classes/store";

/*
 * Route 9 — POST /api/classes/[id]/invites (teacher only).
 *
 * { emails:[…] } → upsert idempotent `class_invites` rows (one per normalized,
 * email-shaped address; re-inviting the same address updates, never duplicates)
 * and return { invites:[{id,email,status,acceptLink}], warning? } so the teacher
 * can copy each tokenised accept link and send it through their own channel.
 * NO real email is sent (invite-by-link; captain decision). No seat is taken —
 * that happens only on accept — so an over-cap batch is WARNED, never blocked.
 * The accept link is built from the request origin.
 */
export const POST = withUser<typeof createInvitesSchema, { id: string }>(
  createInvitesSchema,
  async ({ userId, input, params, req }) => {
    const origin = new URL(req.url).origin;
    const result = await classesStore.forUser(userId).createInvites(params.id, input.emails, origin);
    return NextResponse.json(result, { headers: MUTABLE_JSON_CACHE_HEADERS });
  },
);
