import { NextResponse } from "next/server";
import { withOwner, withUser } from "@/lib/api";
import { emptySchema, patchPromptSchema } from "@/lib/api-schemas";
import { writingStore } from "@/lib/writing/store";

type P = { id: string };

/** PATCH { visibility } -> { prompt }. Publishing/unpublishing a prompt into the
 *  shared bank is site-owner-only (withOwner); anyone else gets 403. */
export const PATCH = withOwner<typeof patchPromptSchema, P>(
  patchPromptSchema,
  async ({ userId, input, params }) => {
    const prompt = await writingStore
      .forUser(userId)
      .setPromptVisibility(params.id, input.visibility);
    if (!prompt) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ prompt });
  },
);

/** DELETE -> { ok }. The prompt's author (or the site owner) removes it; past
 *  submissions against it are kept. 403 comes from the wrapper's
 *  PromptForbiddenError mapping. */
export const DELETE = withUser<typeof emptySchema, P>(
  emptySchema,
  async ({ userId, params }) => {
    const ok = await writingStore.forUser(userId).deletePrompt(params.id);
    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  },
);
