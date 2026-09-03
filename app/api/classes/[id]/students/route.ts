import { NextResponse } from "next/server";
import { withUser, MUTABLE_JSON_CACHE_HEADERS } from "@/lib/api";
import { emptySchema } from "@/lib/api-schemas";
import { classesStore } from "@/lib/classes/store";

/** GET -> { students:[{user_id,name,email,joined_at,joined_via}] }. Teacher-only
 *  (403 else); the store checks the caller teaches this class. */
export const GET = withUser<typeof emptySchema, { id: string }>(
  emptySchema,
  async ({ userId, params }) => {
    const students = await classesStore.forUser(userId).roster(params.id);
    return NextResponse.json({ students }, { headers: MUTABLE_JSON_CACHE_HEADERS });
  },
);
