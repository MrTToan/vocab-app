/*
 * Completion derivation for assignments — read-only, computed LIVE from data that
 * already exists (attempts × word_collections), never a new per-attempt tracking
 * table (captain decision: completion = "practiced at least once"). Standalone
 * getDb() SQL so it needs no change to the dual-backend ScopedStore interface.
 *
 * A vocab-collection assignment is "practiced" once the student has ≥ 1 logged
 * practice attempt on ANY word in the collection MADE AT OR AFTER the moment that
 * student was assigned (`assignment_targets.created_at`, passed in as `since`).
 * Practice done BEFORE the assignment existed never counts — a freshly-assigned
 * student starts at "not practised yet" regardless of prior history, and only new
 * attempts move the bar. `practiced`/`total` give the teacher the real texture
 * (e.g. "3 / 20 words"); the binary done-flag flips at `practiced ≥ 1`.
 */

import { getDb } from "../db";

export interface CollectionPractice {
  total: number; // member words in the collection
  practiced: number; // distinct member words this user has ≥1 attempt on
}

/** How many words a collection has (its assignment "denominator"). */
export async function collectionSize(collectionId: string): Promise<number> {
  const db = await getDb();
  const rs = await db.execute({
    sql: "SELECT COUNT(*) AS n FROM word_collections WHERE collection_id = ?",
    args: [collectionId],
  });
  return Number(rs.rows[0]?.n ?? 0);
}

/** One student's practice coverage of a collection, counting only attempts made
 *  at or after `since` (the moment the student was assigned). */
export async function collectionPracticeFor(
  userId: string,
  collectionId: string,
  since: number,
): Promise<CollectionPractice> {
  const db = await getDb();
  const [total, practiced] = await Promise.all([
    collectionSize(collectionId),
    db
      .execute({
        sql: `SELECT COUNT(DISTINCT at.word_id) AS n
                FROM attempts at
                JOIN word_collections wc ON wc.word_id = at.word_id
               WHERE at.user_id = ? AND wc.collection_id = ? AND at.ts >= ?`,
        args: [userId, collectionId, since],
      })
      .then((rs) => Number(rs.rows[0]?.n ?? 0)),
  ]);
  return { total, practiced };
}

/** Practice coverage for many students at once (one grouped query — no N+1 on the
 *  teacher's per-student view). `since` is a PER-STUDENT map of the moment each was
 *  assigned; a student's attempt counts only if made at or after their own `since`,
 *  so students assigned at different times grade correctly. Every id is present in
 *  the result (0 when none). */
export async function collectionPracticeForMany(
  userIds: string[],
  collectionId: string,
  since: Record<string, number>,
): Promise<Record<string, CollectionPractice>> {
  const total = await collectionSize(collectionId);
  const out: Record<string, CollectionPractice> = {};
  for (const id of userIds) out[id] = { total, practiced: 0 };
  if (userIds.length === 0) return out;
  const db = await getDb();
  const placeholders = userIds.map(() => "?").join(",");
  // Per-student lower time bound via a CASE mapping user_id → their `since`. An id
  // missing from the map falls back to +∞ (counts nothing) rather than 0 (which
  // would re-open the pre-assignment bug).
  const whenClauses = userIds.map(() => "WHEN ? THEN ?").join(" ");
  const rs = await db.execute({
    sql: `SELECT at.user_id AS uid, COUNT(DISTINCT at.word_id) AS n
            FROM attempts at
            JOIN word_collections wc ON wc.word_id = at.word_id
           WHERE wc.collection_id = ? AND at.user_id IN (${placeholders})
             AND at.ts >= (CASE at.user_id ${whenClauses} ELSE ? END)
           GROUP BY at.user_id`,
    args: [
      collectionId,
      ...userIds,
      ...userIds.flatMap((id) => [id, since[id] ?? Number.MAX_SAFE_INTEGER]),
      Number.MAX_SAFE_INTEGER,
    ],
  });
  for (const r of rs.rows as Record<string, unknown>[]) {
    const uid = String(r.uid);
    if (out[uid]) out[uid].practiced = Number(r.n ?? 0);
  }
  return out;
}
