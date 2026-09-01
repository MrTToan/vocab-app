import { NextResponse } from "next/server";
import { writingStore, PromptForbiddenError } from "@/lib/writing/store";
import { currentUserId } from "@/lib/auth/user";
import type { PromptVisibility } from "@/lib/writing/types";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH { visibility } -> { prompt }. Publishing/unpublishing a prompt into the
 *  shared bank is site-owner-only; anyone else gets 403 (404 if not visible). */
export async function PATCH(req: Request, ctx: Ctx) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const { visibility } = (await req.json()) as { visibility?: PromptVisibility };
  if (visibility !== "public" && visibility !== "private") {
    return NextResponse.json({ error: "visibility must be public or private" }, { status: 400 });
  }
  try {
    const prompt = await writingStore.forUser(userId).setPromptVisibility(id, visibility);
    if (!prompt) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ prompt });
  } catch (e) {
    if (e instanceof PromptForbiddenError)
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }
}

/** DELETE -> { ok }. The prompt's author (or the site owner) removes it; past
 *  submissions against it are kept. */
export async function DELETE(_req: Request, ctx: Ctx) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const ok = await writingStore.forUser(userId).deletePrompt(id);
    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof PromptForbiddenError)
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }
}
