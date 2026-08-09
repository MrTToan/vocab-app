import { NextResponse } from "next/server";
import { writingStore } from "@/lib/writing/store";
import { currentUserId } from "@/lib/auth/user";
import { WRITING_TASKS, type WritingTask } from "@/lib/writing/types";

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
