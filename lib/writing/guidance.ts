import { promises as fs } from "fs";
import path from "path";
import type { WritingTask } from "./types";

/*
 * The "teacher's advice/formulas" feature. Curated markdown in
 * content/writing/guidance/ is concatenated and injected into the scoring prompt
 * so the LLM grades by the user's own rules. No RAG — the files are small and
 * loaded wholesale. Add a rule → edit a file → next score uses it.
 *
 * Load order (all optional): general.md, then <task>.md (task1.md / task2.md).
 */

const GUIDANCE_DIR = path.join(process.cwd(), "content", "writing", "guidance");

async function readIfExists(file: string): Promise<string> {
  try {
    return (await fs.readFile(file, "utf8")).trim();
  } catch {
    return "";
  }
}

/** Concatenated guidance for a task (empty string if none configured). */
export async function loadGuidance(task: WritingTask): Promise<string> {
  const parts = await Promise.all([
    readIfExists(path.join(GUIDANCE_DIR, "general.md")),
    readIfExists(path.join(GUIDANCE_DIR, `${task}.md`)),
  ]);
  return parts.filter(Boolean).join("\n\n");
}
