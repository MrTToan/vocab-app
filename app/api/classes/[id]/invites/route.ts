import { NextResponse } from "next/server";
import { withUser, MUTABLE_JSON_CACHE_HEADERS } from "@/lib/api";
import { createInvitesSchema } from "@/lib/api-schemas";
import { classesStore } from "@/lib/classes/store";
import { publicOrigin } from "@/lib/origin";

/*
 * Route 9 — POST /api/classes/[id]/invites (teacher only).
 *
 * { emails:[…] } → upsert idempotent `class_invites` rows (one per normalized,
 * email-shaped address; re-inviting the same address updates, never duplicates)
 * and return { invites:[{id,email,status,acceptLink,emailed}], warning? }. Lexi
 * emails each newly-created / still-pending accept link automatically (Resend,
 * best-effort — a send failure never fails the request, it just surfaces a soft
 * warning + `emailed:false`), and the copyable link is still returned as a
 * fallback. No seat is taken — that happens only on accept — so an over-cap
 * batch is WARNED, never blocked.
 * The accept link is built from the canonical public origin (`publicOrigin`),
 * not the raw request origin, so it survives the reverse proxy in prod.
 */
export const POST = withUser<typeof createInvitesSchema, { id: string }>(
  createInvitesSchema,
  async ({ userId, input, params, req }) => {
    const origin = publicOrigin(req);
    const result = await classesStore.forUser(userId).createInvites(params.id, input.emails, origin);
    return NextResponse.json(result, { headers: MUTABLE_JSON_CACHE_HEADERS });
  },
);
