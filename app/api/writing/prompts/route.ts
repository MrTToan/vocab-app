import { NextResponse } from "next/server";
import { writingStore } from "@/lib/writing/store";
import { currentUserId, canEdit, isOwner } from "@/lib/auth/user";
import {
  WRITING_TASKS,
  PROMPT_TEXT_MIN,
  PROMPT_TEXT_MAX,
  PROMPT_TITLE_MAX,
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
export async function GET(req: Request) {
  const url = new URL(req.url);
  const task = url.searchParams.get("task") as WritingTask | null;
  if (task && !WRITING_TASKS.includes(task)) {
    return NextResponse.json({ error: "invalid task" }, { status: 400 });
  }

  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const store = writingStore.forUser(userId);

  if (url.searchParams.get("pick") !== null) {
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
  const owner = isOwner(userId);
  return NextResponse.json({
    prompts: prompts.map((p) => ({
      ...p,
      stats: stats[p.id] ?? null,
      can_edit: owner || canEdit(userId, p.owner_id),
    })),
  });
}

/**
 * POST -> create one prompt (self-serve "Add a question" flow).
 * Body: { task_type, prompt_text, title?, image?, chart_data? }
 *   - image: a base64 data URL (Task 1 chart), stored inline as image_path.
 *   - chart_data: the confirmed/edited transcription (Task 1 only).
 *
 * Ownership: the site owner's prompt joins the public bank; anyone else's is
 * PRIVATE to them until the site owner publishes it (PATCH /prompts/:id).
 * Limits (400 otherwise): text 10..4,000 chars, title <= 120 chars, image only
 * for Task 1, png/jpeg/webp, <= 1 MB decoded.
 */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as {
    task_type?: string;
    prompt_text?: string;
    title?: string;
    image?: string | null;
    chart_data?: ChartData | null;
  };

  const task_type = body.task_type as WritingTask;
  if (!WRITING_TASKS.includes(task_type)) {
    return NextResponse.json({ error: "task_type must be task1 or task2" }, { status: 400 });
  }
  const prompt_text = typeof body.prompt_text === "string" ? body.prompt_text.trim() : "";
  if (prompt_text.length < PROMPT_TEXT_MIN) {
    return NextResponse.json({ error: "Please paste the question text." }, { status: 400 });
  }
  if (prompt_text.length > PROMPT_TEXT_MAX) {
    return NextResponse.json(
      { error: `The question text is too long (max ${PROMPT_TEXT_MAX.toLocaleString()} characters).` },
      { status: 400 },
    );
  }
  const rawTitle = typeof body.title === "string" ? body.title.trim() : "";
  if (rawTitle.length > PROMPT_TITLE_MAX) {
    return NextResponse.json({ error: `Title is too long (max ${PROMPT_TITLE_MAX} characters).` }, { status: 400 });
  }

  let image: string | null = null;
  if (body.image != null && body.image !== "") {
    if (task_type !== "task1") {
      return NextResponse.json({ error: "Only Task 1 questions take a chart image." }, { status: 400 });
    }
    if (typeof body.image !== "string") {
      return NextResponse.json({ error: "image must be a base64 data URL" }, { status: 400 });
    }
    const parsed = parseImageDataUrl(body.image);
    if (!parsed || !(PROMPT_IMAGE_MIMES as readonly string[]).includes(parsed.mime)) {
      return NextResponse.json({ error: "The chart must be a PNG, JPEG or WebP image." }, { status: 400 });
    }
    if (parsed.bytes.length > PROMPT_IMAGE_MAX_BYTES) {
      return NextResponse.json({ error: "The chart image is too large (max 1 MB)." }, { status: 400 });
    }
    image = body.image;
  }

  // Title: use the user's, else the first line / first ~8 words of the prompt.
  const title =
    rawTitle ||
    prompt_text.split("\n")[0].split(/\s+/).slice(0, 9).join(" ").replace(/[.:,]$/, "") ||
    "Untitled prompt";

  // owner_id / visibility are derived from the caller inside addPrompts.
  const [saved] = await writingStore.forUser(userId).addPrompts([
    {
      task_type,
      title,
      prompt_text,
      image_path: image,
      chart_data: task_type === "task1" ? body.chart_data ?? null : null,
      model_answer: null,
      source_file: "self-serve (in-app)",
      tags: [],
    },
  ]);

  const { image_path, ...rest } = saved;
  return NextResponse.json({ prompt: { ...rest, has_image: !!image_path } });
}
