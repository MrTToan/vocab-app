import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { emptySchema } from "@/lib/api-schemas";
import { classesStore } from "@/lib/classes/store";

/** POST -> { ok }. The student leaves the class themselves; their report
 *  visibility is revoked immediately (the trust story, §6). Benign no-op if the
 *  caller has no student membership. */
export const POST = withUser<typeof emptySchema, { id: string }>(
  emptySchema,
  async ({ userId, params }) => {
    await classesStore.forUser(userId).leaveClass(params.id);
    return NextResponse.json({ ok: true });
  },
);
