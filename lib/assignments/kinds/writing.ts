/*
 * The `writing_prompt` kind — assign a writing question (an IELTS-style Task 1 or
 * Task 2 prompt from the writing bank). Slice 2's drop-in adapter; it adds NOTHING
 * to the schema, the routes, or the shared UI — it is the adapter + one registry
 * line + the enum string, exactly the extensibility Slice 1's spine promised.
 *
 * - SELECT: the writing bank is ADMIN-CURATED and PUBLIC (self-serve authoring was
 *   retired — POST /api/writing/prompts is admin-only and writes the `__system__`
 *   public bank). So there are no teacher-owned PRIVATE writing prompts to grant
 *   visibility for: every assignable prompt is already public and visible to every
 *   student through the normal writing flow. We therefore SKIP Slice 1's
 *   assign-grants-visibility mechanism (nothing in lib/writing/store.ts's VISIBLE
 *   filter needs extending) and restrict assignability to PUBLIC prompts, so a
 *   targeted student can always open what they were assigned. (Contrast vocab, where
 *   a teacher's own private set needs the target-row grant — see lib/store.ts.)
 * - DO: `/writing/task{1,2}?q=<promptId>` — the EXISTING deep-link the writing page
 *   already honours (lib/writing/deeplink.ts, components/writing/WritingPractice.tsx);
 *   no parallel player.
 * - MEASURE: "submitted" — the writing analog of vocab's "practised once": the
 *   student has ≥1 stored submission for the prompt
 *   (writingStore.forUser(studentId).latestSubmission(promptId)).
 */

import { getDb } from "../../db";
import { writingStore } from "../../writing/store";
import type { WritingTask } from "../../writing/types";
import type { AssignmentProgress, ContentCard, PickableContent } from "../types";
import type { AssignableKind } from "./kind";

const EMOJI = "✍️";

const doHref = (task: WritingTask, id: string) =>
  `/writing/${task}?q=${encodeURIComponent(id)}`;

const subtitle = (task: WritingTask) => (task === "task1" ? "Task 1" : "Task 2");

/** Prompt display meta by id, with NO visibility check (the store only resolves
 *  refs a viewer is authorized to see — see AssignableKind.resolveCard; assignable
 *  writing prompts are public anyway). */
async function promptMeta(
  id: string,
): Promise<{ title: string; task_type: WritingTask } | null> {
  const db = await getDb();
  const rs = await db.execute({
    sql: "SELECT title, task_type FROM writing_prompts WHERE id = ? LIMIT 1",
    args: [id],
  });
  const r = rs.rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  const task = String(r.task_type) === "task1" ? "task1" : "task2";
  return { title: String(r.title ?? ""), task_type: task };
}

interface WritingDone {
  submitted: boolean;
  band: number | null; // best overall band across submissions, when submitted
}

function gradeWriting(p: WritingDone): AssignmentProgress {
  // Captain decision (writing analog of vocab's "practised once"): completion =
  // the student has SUBMITTED the prompt at least once. Binary — a writing prompt
  // has no partial coverage the way a set does.
  const state = p.submitted ? "complete" : "not_started";
  const pct = p.submitted ? 100 : 0;
  const detail = p.submitted
    ? p.band && p.band > 0
      ? `Submitted · band ${p.band.toFixed(1)}`
      : "Submitted"
    : "Not submitted yet";
  return { state, pct, detail };
}

/** Best overall band + submission count per student for one prompt, in ONE grouped
 *  query (no N+1 on the teacher's grid). Every requested id is present. */
async function submittedForMany(
  studentIds: string[],
  promptId: string,
): Promise<Record<string, WritingDone>> {
  const out: Record<string, WritingDone> = {};
  for (const id of studentIds) out[id] = { submitted: false, band: null };
  if (studentIds.length === 0) return out;
  const db = await getDb();
  const placeholders = studentIds.map(() => "?").join(",");
  const rs = await db.execute({
    sql: `SELECT user_id AS uid, COUNT(*) AS n, MAX(overall_band) AS band
            FROM writing_submissions
           WHERE prompt_id = ? AND user_id IN (${placeholders})
           GROUP BY user_id`,
    args: [promptId, ...studentIds],
  });
  for (const r of rs.rows as Record<string, unknown>[]) {
    const uid = String(r.uid);
    if (out[uid] && Number(r.n ?? 0) > 0) {
      out[uid] = { submitted: true, band: r.band == null ? null : Number(r.band) };
    }
  }
  return out;
}

export const writingPromptKind: AssignableKind = {
  kind: "writing_prompt",
  label: "Writing prompt",
  emoji: EMOJI,

  async listPickable(userId, q): Promise<PickableContent[]> {
    // The bank is public; a teacher sees public + their own, but only PUBLIC
    // prompts are assignable (so the student can always open the assigned prompt —
    // no visibility grant for writing; see the file header).
    const prompts = await writingStore.forUser(userId).listPrompts();
    const needle = q.trim().toLowerCase();
    return prompts
      .filter((p) => p.visibility === "public")
      .filter(
        (p) =>
          !needle ||
          p.title.toLowerCase().includes(needle) ||
          p.prompt_text.toLowerCase().includes(needle),
      )
      .map((p) => ({
        kind: "writing_prompt" as const,
        ref: p.id,
        title: p.title || "(untitled prompt)",
        emoji: EMOJI,
        subtitle: subtitle(p.task_type),
        doHref: doHref(p.task_type, p.id),
      }));
  },

  async validateRef(ref, teacherId) {
    const p = await writingStore.forUser(teacherId).getPrompt(ref);
    if (!p) return { ok: false, reason: "That writing question doesn't exist or isn't available to you." };
    // Only PUBLIC prompts are assignable — a private draft would be invisible to
    // the targeted students (writing has no assign-grants-visibility path).
    if (p.visibility !== "public")
      return { ok: false, reason: "Only published writing questions can be assigned." };
    return { ok: true };
  },

  async resolveCard(ref): Promise<ContentCard> {
    const meta = await promptMeta(ref);
    if (!meta) {
      return {
        kind: "writing_prompt",
        ref,
        title: "(removed prompt)",
        emoji: EMOJI,
        subtitle: "no longer available",
        doHref: doHref("task2", ref),
        available: false,
      };
    }
    return {
      kind: "writing_prompt",
      ref,
      title: meta.title || "(untitled prompt)",
      emoji: EMOJI,
      subtitle: subtitle(meta.task_type),
      doHref: doHref(meta.task_type, ref),
      available: true,
    };
  },

  defaultCriteria() {
    return { rule: "submitted" };
  },

  async progressFor(studentId, ref) {
    const sub = await writingStore.forUser(studentId).latestSubmission(ref);
    return gradeWriting({ submitted: !!sub, band: sub ? sub.overall_band : null });
  },

  async progressForMany(studentIds, ref) {
    const many = await submittedForMany(studentIds, ref);
    const out: Record<string, AssignmentProgress> = {};
    for (const id of studentIds) out[id] = gradeWriting(many[id] ?? { submitted: false, band: null });
    return out;
  },
};
