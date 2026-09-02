import { NextResponse } from "next/server";
import { withOwner, withUser } from "@/lib/api";
import { createPromptSchema, writingPromptsQuerySchema } from "@/lib/api-schemas";
import { writingStore } from "@/lib/writing/store";
import { canEdit } from "@/lib/auth/user";
import {
  WRITING_TASKS,
  PROMPT_TEXT_MIN,
  PROMPT_TEXT_MAX,
  PROMPT_IMAGE_MAX_BYTES,
  PROMPT_IMAGE_MIMES,
  type WritingTask,
  type ChartData,
} from "@/lib/writing/types";
import { parseImageDataUrl } from "@/lib/writing/image";

/**
 * GET /api/writing/prompts?task=task2         -> { prompts: [...] }
 * GET /api/writing/prompts?task=task2&pick=1  -> { prompt }  (least-recently-shown)
 *
 * Only prompts the caller may see: the public bank plus their own private ones.
 * List rows carry `has_image` instead of the image itself (fetch it from
 * `/api/writing/prompts/:id/image`) and `can_edit` (may the caller delete it).
 */
export const GET = withUser(
  writingPromptsQuerySchema,
  async ({ userId, owner, input, req }) => {
    const task = (input.task ?? null) as WritingTask | null;
    if (task && !WRITING_TASKS.includes(task)) {
      return NextResponse.json({ error: "invalid task" }, { status: 400 });
    }

    const store = writingStore.forUser(userId);

    if (new URL(req.url).searchParams.get("pick") !== null) {
      if (!task) return NextResponse.json({ error: "task required to pick" }, { status: 400 });
      const prompt = await store.pickPrompt(task);
      if (!prompt) return NextResponse.json({ prompt: null });
      return NextResponse.json({ prompt });
    }

    const [prompts, stats] = await Promise.all([
      store.listPrompts(task ?? undefined),
      store.promptStats(task ?? undefined),
    ]);
    // attach each prompt's practice summary (null if never attempted)
    return NextResponse.json({
      prompts: prompts.map((p) => ({
        ...p,
        stats: stats[p.id] ?? null,
        can_edit: owner || canEdit(userId, p.owner_id),
      })),
    });
  },
);

/**
 * POST -> create one writing question. ADMIN-ONLY (withOwner): regular users can
 * no longer create writing questions — the admin curates the shared bank from
 * the admin "Writing Questions" subtab, and this route is the server-level gate
 * (403 for non-admins).
 * Body: { task_type, prompt_text, title?, image?, chart_data?, model_answer?, visibility? }
 *   - image: a base64 data URL (Task 1 chart), stored inline as image_path.
 *   - chart_data: the confirmed/edited transcription (Task 1 only).
 *   - visibility: publish state (defaults to public — an admin-created question
 *     is published; pass "private" to keep it as a draft).
 *
 * Ownership: the admin's prompt joins the shared bank (`owner_id = __system__`).
 * Limits (400 otherwise): text 10..4,000 chars, title <= 120 chars, image only
 * for Task 1, png/jpeg/webp, <= 1 MB decoded.
 */
export const POST = withOwner(
  createPromptSchema,
  async ({ userId, input }) => {
    const task_type = input.task_type as WritingTask;
    if (!WRITING_TASKS.includes(task_type)) {
      return NextResponse.json({ error: "task_type must be task1 or task2" }, { status: 400 });
    }
    const prompt_text = input.prompt_text.trim();
    if (prompt_text.length < PROMPT_TEXT_MIN) {
      return NextResponse.json({ error: "Please paste the question text." }, { status: 400 });
    }
    if (prompt_text.length > PROMPT_TEXT_MAX) {
      return NextResponse.json(
        { error: `The question text is too long (max ${PROMPT_TEXT_MAX.toLocaleString()} characters).` },
        { status: 400 },
      );
    }
    const rawTitle = (input.title ?? "").trim();

    let image: string | null = null;
    if (input.image != null && input.image !== "") {
      if (task_type !== "task1") {
        return NextResponse.json({ error: "Only Task 1 questions take a chart image." }, { status: 400 });
      }
      const parsed = parseImageDataUrl(input.image);
      if (!parsed || !(PROMPT_IMAGE_MIMES as readonly string[]).includes(parsed.mime)) {
        return NextResponse.json({ error: "The chart must be a PNG, JPEG or WebP image." }, { status: 400 });
      }
      if (parsed.bytes.length > PROMPT_IMAGE_MAX_BYTES) {
        return NextResponse.json({ error: "The chart image is too large (max 1 MB)." }, { status: 400 });
      }
      image = input.image;
    }

    // Title: use the user's, else the first line / first ~8 words of the prompt.
    const title =
      rawTitle ||
      prompt_text.split("\n")[0].split(/\s+/).slice(0, 9).join(" ").replace(/[.:,]$/, "") ||
      "Untitled prompt";

    // owner_id defaults to the shared bank for an admin (inside addPrompts).
    const [saved] = await writingStore.forUser(userId).addPrompts([
      {
        task_type,
        title,
        prompt_text,
        image_path: image,
        chart_data: task_type === "task1" ? (input.chart_data as ChartData | null) ?? null : null,
        model_answer: input.model_answer ?? null,
        source_file: "admin (in-app)",
        tags: [],
        visibility: input.visibility,
      },
    ]);

    const { image_path, ...rest } = saved;
    return NextResponse.json({ prompt: { ...rest, has_image: !!image_path } });
  },
  // The Task 1 chart is a base64 data URL of up to 1 MB decoded (~1.4 MB encoded).
  { maxBytes: 2 * 1024 * 1024 },
);
