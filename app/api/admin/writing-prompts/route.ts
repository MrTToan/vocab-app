import { NextResponse } from "next/server";
import { withOwner } from "@/lib/api";
import { adminWritingPromptsQuerySchema } from "@/lib/api-schemas";
import { writingStore } from "@/lib/writing/store";
import { WRITING_TASKS, type WritingTask } from "@/lib/writing/types";

/**
 * GET /api/admin/writing-prompts[?task=task1|task2] -> { prompts: [...] }
 *
 * ADMIN-ONLY (withOwner). The authoritative bank for the admin "Writing
 * Questions" management subtab: EVERY prompt (both tasks, drafts + published),
 * ignoring the per-learner visibility filter, WITHOUT image bytes (each chart is
 * fetched lazily from `/api/writing/prompts/:id/image`). Search + visibility
 * filtering happen client-side over this list; `?task=` narrows by task server-side.
 */
export const GET = withOwner(
  adminWritingPromptsQuerySchema,
  async ({ userId, input }) => {
    const task = (input.task ?? null) as WritingTask | null;
    if (task && !WRITING_TASKS.includes(task)) {
      return NextResponse.json({ error: "invalid task" }, { status: 400 });
    }
    const prompts = await writingStore.forUser(userId).listAllPromptsAdmin(task ?? undefined);
    return NextResponse.json({ prompts });
  },
);
