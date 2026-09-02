import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { emptySchema, patchWordSchema } from "@/lib/api-schemas";
import { getStore } from "@/lib/store";

type P = { id: string };

/** Full word (all fields) — used to lazily load a word's editor detail after the
 *  Library list is fetched slim via GET /api/words?fields=list. */
export const GET = withUser<typeof emptySchema, P>(
  emptySchema,
  async ({ userId, params }) => {
    const word = await getStore().forUser(userId).get(params.id);
    if (!word) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ word });
  },
);

/** PATCH — editable CONTENT fields only. The schema strips identity/ownership/
 *  progress keys, so the client can never rewrite them (403 via the wrapper's
 *  ForbiddenError mapping when the caller doesn't own the word). */
export const PATCH = withUser<typeof patchWordSchema, P>(
  patchWordSchema,
  async ({ userId, input, params }) => {
    const updated = await getStore().forUser(userId).update(params.id, input);
    if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ word: updated });
  },
);

export const DELETE = withUser<typeof emptySchema, P>(
  emptySchema,
  async ({ userId, params }) => {
    await getStore().forUser(userId).remove(params.id);
    return NextResponse.json({ ok: true });
  },
);
