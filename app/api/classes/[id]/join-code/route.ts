import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { emptySchema } from "@/lib/api-schemas";
import { classesStore } from "@/lib/classes/store";

/** POST -> { join_code }. Teacher-only. Generates a new code or rotates the
 *  existing one (the old code stops working). */
export const POST = withUser<typeof emptySchema, { id: string }>(
  emptySchema,
  async ({ userId, params }) => {
    const join_code = await classesStore.forUser(userId).setJoinCode(params.id);
    return NextResponse.json({ join_code });
  },
);

/** DELETE -> { ok }. Teacher-only. Disables joining (sets join_code = NULL). */
export const DELETE = withUser<typeof emptySchema, { id: string }>(
  emptySchema,
  async ({ userId, params }) => {
    await classesStore.forUser(userId).disableJoinCode(params.id);
    return NextResponse.json({ ok: true });
  },
);
