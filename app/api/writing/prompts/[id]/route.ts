import { NextResponse } from "next/server";
import { withOwner } from "@/lib/api";
import { emptySchema, patchPromptSchema } from "@/lib/api-schemas";
import { writingStore } from "@/lib/writing/store";
import {
  WRITING_TASKS,
  PROMPT_TEXT_MIN,
  PROMPT_IMAGE_MAX_BYTES,
  PROMPT_IMAGE_MIMES,
  type WritingTask,
  type ChartData,
  type WritingPrompt,
} from "@/lib/writing/types";
import { parseImageDataUrl } from "@/lib/writing/image";

type P = { id: string };

/**
 * PATCH -> { prompt }. ADMIN-ONLY (withOwner): the admin manages the shared
 * writing-question bank. Accepts a publish/visibility flip AND/OR content edits
 * (title, prompt_text, task_type, model_answer, and a Task 1 chart image + its
 * transcription). A visibility-only body reuses the store's publish path; any
 * content field goes through the admin content update. 403 for non-admins.
 */
export const PATCH = withOwner<typeof patchPromptSchema, P>(
  patchPromptSchema,
  async ({ userId, input, params }) => {
    const store = writingStore.forUser(userId);

    const editsContent =
      input.task_type !== undefined ||
      input.title !== undefined ||
      input.prompt_text !== undefined ||
      input.model_answer !== undefined ||
      input.image !== undefined ||
      input.chart_data !== undefined;

    // Visibility-only change: the existing publish path (unchanged behaviour).
    if (!editsContent) {
      if (input.visibility === undefined) {
        return NextResponse.json({ error: "no fields to update" }, { status: 400 });
      }
      const prompt = await store.setPromptVisibility(params.id, input.visibility);
      if (!prompt) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ prompt });
    }

    // ── content edit ──
    const patch: Partial<
      Pick<
        WritingPrompt,
        "title" | "prompt_text" | "task_type" | "image_path" | "chart_data" | "model_answer" | "visibility"
      >
    > = {};

    if (input.task_type !== undefined) {
      const task_type = input.task_type as WritingTask;
      if (!WRITING_TASKS.includes(task_type)) {
        return NextResponse.json({ error: "task_type must be task1 or task2" }, { status: 400 });
      }
      patch.task_type = task_type;
    }
    if (input.title !== undefined) patch.title = input.title.trim() || "Untitled prompt";
    if (input.prompt_text !== undefined) {
      const prompt_text = input.prompt_text.trim();
      if (prompt_text.length < PROMPT_TEXT_MIN) {
        return NextResponse.json({ error: "Please paste the question text." }, { status: 400 });
      }
      patch.prompt_text = prompt_text;
    }
    if (input.model_answer !== undefined) {
      patch.model_answer = input.model_answer ? input.model_answer : null;
    }
    if (input.image !== undefined) {
      if (input.image === null || input.image === "") {
        patch.image_path = null;
      } else {
        const parsed = parseImageDataUrl(input.image);
        if (!parsed || !(PROMPT_IMAGE_MIMES as readonly string[]).includes(parsed.mime)) {
          return NextResponse.json({ error: "The chart must be a PNG, JPEG or WebP image." }, { status: 400 });
        }
        if (parsed.bytes.length > PROMPT_IMAGE_MAX_BYTES) {
          return NextResponse.json({ error: "The chart image is too large (max 1 MB)." }, { status: 400 });
        }
        patch.image_path = input.image;
      }
    }
    if (input.chart_data !== undefined) patch.chart_data = (input.chart_data as ChartData | null) ?? null;
    if (input.visibility !== undefined) patch.visibility = input.visibility;

    const prompt = await store.updatePromptAdmin(params.id, patch);
    if (!prompt) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ prompt });
  },
  // A Task 1 chart is a base64 data URL of up to 1 MB decoded (~1.4 MB encoded).
  { maxBytes: 2 * 1024 * 1024 },
);

/** DELETE -> { ok }. ADMIN-ONLY (withOwner): the admin removes a question from
 *  the bank; past submissions against it are kept. 403 for non-admins. */
export const DELETE = withOwner<typeof emptySchema, P>(
  emptySchema,
  async ({ userId, params }) => {
    const ok = await writingStore.forUser(userId).deletePrompt(params.id);
    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  },
);
