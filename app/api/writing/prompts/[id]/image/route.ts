import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { emptySchema } from "@/lib/api-schemas";
import { writingStore } from "@/lib/writing/store";
import { parseImageDataUrl } from "@/lib/writing/image";

/**
 * GET /api/writing/prompts/:id/image -> the Task 1 chart image bytes.
 * Visibility-checked like the prompt itself (public or the caller's own).
 * The list endpoint deliberately omits the inline image, so the client fetches
 * only the selected prompt's chart here and the browser caches it per user.
 */
export const GET = withUser<typeof emptySchema, { id: string }>(
  emptySchema,
  async ({ userId, req, params }) => {
    const stored = await writingStore.forUser(userId).getPromptImage(params.id);
    if (!stored) return NextResponse.json({ error: "not found" }, { status: 404 });

    // Legacy ingest stored a /public path (e.g. /writing/task1/x.svg) — hand off.
    if (stored.startsWith("/")) {
      return NextResponse.redirect(new URL(stored, req.url), 302);
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
  },
);
