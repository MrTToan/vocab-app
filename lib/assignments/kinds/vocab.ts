/*
 * The `vocab_collection` kind — assign a vocabulary collection (a public catalog
 * pack or the teacher's own private set). This is the ONLY kind implemented in
 * Slice 1; it exercises the whole adapter shape so writing (Slice 2) is a drop-in.
 *
 * - SELECT: the teacher's own private collections + every public one (store.collections()).
 * - DO: `/practice?collection=<id>` — the EXISTING deep-link the "Study →" button
 *   uses (components/vocab/Collections.tsx). A private collection works for a
 *   targeted student because the assignment grant makes it visible in the practice
 *   path (lib/store.ts collectionVisibleTo).
 * - MEASURE: "practiced at least once" — ≥1 attempt on any member word
 *   (lib/assignments/progress.ts). Global progress, no new tracking.
 */

import { getDb } from "../../db";
import { getStore } from "../../store";
import type { ContentCard, PickableContent } from "../types";
import { collectionPracticeFor, collectionPracticeForMany } from "../progress";
import type { CollectionPractice } from "../progress";
import type { AssignableKind } from "./kind";

const doHref = (id: string) => `/practice?collection=${encodeURIComponent(id)}`;

/** Collection display meta by id, with NO visibility check (the store only
 *  resolves refs a viewer is authorized to see — see AssignableKind.resolveCard). */
async function collectionMeta(
  id: string,
): Promise<{ name: string; emoji: string; count: number } | null> {
  const db = await getDb();
  const rs = await db.execute({
    sql: `SELECT c.name, c.emoji, COUNT(wc.word_id) AS cnt
            FROM collections c
            LEFT JOIN word_collections wc ON wc.collection_id = c.id
           WHERE c.id = ?
           GROUP BY c.id`,
    args: [id],
  });
  const r = rs.rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    name: String(r.name ?? ""),
    emoji: r.emoji == null ? "" : String(r.emoji),
    count: Number(r.cnt ?? 0),
  };
}

const subtitle = (count: number) => `${count} word${count === 1 ? "" : "s"}`;

function gradeVocab(p: CollectionPractice): {
  state: "not_started" | "in_progress" | "complete";
  pct: number;
  detail: string;
} {
  // Captain decision: completion = "practiced at least once" (≥1 attempt on the
  // set). The bar shows real coverage (practiced / total) as texture.
  const pct = p.total > 0 ? Math.round((p.practiced / p.total) * 100) : p.practiced > 0 ? 100 : 0;
  const state = p.practiced === 0 ? "not_started" : "complete";
  const detail =
    p.practiced === 0
      ? "Not practised yet"
      : `Practised ${p.practiced} / ${p.total} word${p.total === 1 ? "" : "s"}`;
  return { state, pct, detail };
}

export const vocabCollectionKind: AssignableKind = {
  kind: "vocab_collection",
  label: "Vocabulary set",
  emoji: "📗",

  async listPickable(userId, q): Promise<PickableContent[]> {
    const cols = await getStore().forUser(userId).collections(); // own private + all public
    const needle = q.trim().toLowerCase();
    return cols
      .filter((c) => !needle || c.name.toLowerCase().includes(needle))
      .map((c) => ({
        kind: "vocab_collection" as const,
        ref: c.id,
        title: c.name,
        emoji: c.emoji || "📗",
        subtitle: subtitle(c.count ?? 0),
        doHref: doHref(c.id),
      }));
  },

  async validateRef(ref, teacherId) {
    // Assignable = a collection the teacher can see (their own private, or public).
    const cols = await getStore().forUser(teacherId).collections();
    const found = cols.find((c) => c.id === ref);
    if (!found) return { ok: false, reason: "That set doesn't exist or isn't available to you." };
    return { ok: true };
  },

  async resolveCard(ref): Promise<ContentCard> {
    const meta = await collectionMeta(ref);
    if (!meta) {
      return {
        kind: "vocab_collection",
        ref,
        title: "(removed set)",
        emoji: "📗",
        subtitle: "no longer available",
        doHref: doHref(ref),
        available: false,
      };
    }
    return {
      kind: "vocab_collection",
      ref,
      title: meta.name || "(untitled set)",
      emoji: meta.emoji || "📗",
      subtitle: subtitle(meta.count),
      doHref: doHref(ref),
      available: true,
    };
  },

  defaultCriteria() {
    return { rule: "practiced" };
  },

  async progressFor(studentId, ref) {
    return gradeVocab(await collectionPracticeFor(studentId, ref));
  },

  async progressForMany(studentIds, ref) {
    const many = await collectionPracticeForMany(studentIds, ref);
    const out: Record<string, ReturnType<typeof gradeVocab>> = {};
    for (const id of studentIds) out[id] = gradeVocab(many[id] ?? { total: 0, practiced: 0 });
    return out;
  },
};
