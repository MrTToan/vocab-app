import { NextResponse } from "next/server";
import { writingStore } from "@/lib/writing/store";
import { currentUserId } from "@/lib/auth/user";
import { WRITING_TASKS, type WritingTask, type ChartData } from "@/lib/writing/types";

/**
 * GET /api/writing/prompts?task=task2         -> { prompts: [...] }
 * GET /api/writing/prompts?task=task2&pick=1  -> { prompt }  (least-recently-shown)
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
  return NextResponse.json({
    prompts: prompts.map((p) => ({ ...p, stats: stats[p.id] ?? null })),
  });
}

/**
 * POST -> create one prompt (self-serve "Add a question" flow).
 * Body: { task_type, prompt_text, title?, image?, chart_data? }
 *   - image: a base64 data URL (Task 1 chart), stored inline as image_path.
 *   - chart_data: the confirmed/edited transcription (Task 1 only).
 */
export async function POST(req: Request) {
  // Writing prompts are a shared pool; require a signed-in user so anonymous
  // visitors can't add to it. (Whether ALL users should write to the shared pool
  // vs owner-only is a product decision — see deploy notes.)
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
  const prompt_text = (body.prompt_text ?? "").trim();
  if (prompt_text.length < 10) {
    return NextResponse.json({ error: "Please paste the question text." }, { status: 400 });
  }
  if (body.image && !body.image.startsWith("data:")) {
    return NextResponse.json({ error: "image must be a base64 data URL" }, { status: 400 });
  }

  // Title: use the user's, else the first line / first ~8 words of the prompt.
  const title =
    (body.title ?? "").trim() ||
    prompt_text.split("\n")[0].split(/\s+/).slice(0, 9).join(" ").replace(/[.:,]$/, "") ||
    "Untitled prompt";

  // Shared prompt pool; userId is just ingest metadata (see writingStore.forUser).
  const [saved] = await writingStore.forUser(userId).addPrompts([
    {
      task_type,
      title,
      prompt_text,
      image_path: task_type === "task1" ? body.image ?? null : null,
      chart_data: task_type === "task1" ? body.chart_data ?? null : null,
      model_answer: null,
      source_file: "self-serve (in-app)",
      tags: [],
    },
  ]);

  return NextResponse.json({ prompt: saved });
}
