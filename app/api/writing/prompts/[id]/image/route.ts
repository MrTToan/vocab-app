import { NextResponse } from "next/server";
import { writingStore } from "@/lib/writing/store";
import { currentUserId } from "@/lib/auth/user";
import { parseImageDataUrl } from "@/lib/writing/image";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/writing/prompts/:id/image -> the Task 1 chart image bytes.
 * Visibility-checked like the prompt itself (public or the caller's own).
 * The list endpoint deliberately omits the inline image, so the client fetches
 * only the selected prompt's chart here and the browser caches it per user.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const stored = await writingStore.forUser(userId).getPromptImage(id);
  if (!stored) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Legacy ingest stored a /public path (e.g. /writing/task1/x.svg) — hand off.
  if (stored.startsWith("/")) {
    return NextResponse.redirect(new URL(stored, _req.url), 302);
  }
  const parsed = parseImageDataUrl(stored);
  if (!parsed) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new Response(new Uint8Array(parsed.bytes), {
    status: 200,
    headers: {
      "Content-Type": parsed.mime,
      "Content-Length": String(parsed.bytes.length),
      "Cache-Control": "private, max-age=86400",
    },
  });
}
