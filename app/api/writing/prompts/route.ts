import { NextResponse } from "next/server";
import { writingStore } from "@/lib/writing/store";
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

  if (url.searchParams.get("pick") !== null) {
    if (!task) return NextResponse.json({ error: "task required to pick" }, { status: 400 });
    const prompt = await writingStore.pickPrompt(task);
    if (!prompt) return NextResponse.json({ prompt: null });
    return NextResponse.json({ prompt });
  }

  const prompts = await writingStore.listPrompts(task ?? undefined);
  return NextResponse.json({ prompts });
}
