import { describe, it, expect, beforeAll } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { computeAttemptStats, computeWordStats } from "../lib/stats";
import type { Result } from "../lib/types";

/*
 * The latency-pass store queries, against a fresh temp SQLite DB (never the
 * real .data/lexi.db):
 *   - existingWords(): dedup membership probe in SQL (case/trim normalized);
 *   - wordStats()/attemptStats(): SQL aggregation must equal the pure JS
 *     reference computation (lib/stats.ts) on the same data, including
 *     attempts that straddle local-day boundaries (byDay buckets + streak);
 *   - practiceCandidatesLite()/practiceWord(): lean candidate rows hydrate
 *     stage `new` for unstudied collection members; the full word is fetched
 *     for the picked id only.
 */

let store: import("../lib/store").Store;
const OWNER = "local-user"; // DEV_USER_ID fallback → may author __system__ content
const U = "stats-user";

/** Epoch ms for a local time relative to today (dayOffset 0 = today). */
function at(dayOffset: number, hours: number, minutes = 0): number {
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  d.setDate(d.getDate() + dayOffset);
  return d.getTime();
}

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-latency-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
  delete process.env.DATABASE_AUTH_TOKEN;
  delete process.env.SHEET_ID; // force the sqlite backend
  const mod = await import("../lib/store");
  store = mod.getStore();
});

describe("existingWords", () => {
  it("matches case- and trim-insensitively, returning normalized forms", async () => {
    const u = store.forUser(U);
    await u.add({ word: "  Resilient ", vi_meaning: "kiên cường" });
    await u.add({ word: "harbor", vi_meaning: "bến cảng" });
    const set = await u.existingWords([
      "resilient",
      "  RESILIENT  ",
      "Harbor",
      "unknown-word",
      "",
    ]);
    expect(set).toEqual(new Set(["resilient", "harbor"]));
  });

  it("does not see other users' libraries", async () => {
    const other = store.forUser("someone-else");
    expect(await other.existingWords(["resilient"])).toEqual(new Set());
  });
});

describe("SQL stats aggregation ≡ the old JS computation", () => {
  beforeAll(async () => {
    const u = store.forUser(U);
    const words = await u.all();
    const resilient = words.find((w) => w.word === "Resilient")!;
    const harbor = words.find((w) => w.word === "harbor")!;
    await u.add({ word: "meticulous", vi_meaning: "tỉ mỉ" }); // never practised

    await u.setProgress(resilient.id, {
      stage: "known",
      times_seen: 6,
      recent_results: ["correct", "correct", "correct", "correct"],
      last_seen_at: at(0, 12),
    });
    await u.setProgress(harbor.id, {
      stage: "recognition",
      times_seen: 3,
      recent_results: ["correct", "incorrect"], // weak: last answer wrong
      last_seen_at: at(0, 12),
    });

    // Attempts straddling local-day boundaries: yesterday 23:30 vs today 00:30
    // land in DIFFERENT byDay buckets; one ancient attempt sits outside the
    // 14-day window (still counted in overall); streak = today + yesterday = 2
    // (nothing 2 days ago). Includes a byType tie (cloze/flashcard 1 each).
    const seed: { ts: number; t: string; r: Result; w: string }[] = [
      { ts: at(0, 0, 30), t: "cloze", r: "correct", w: resilient.id },
      { ts: at(0, 9), t: "flashcard", r: "partial", w: resilient.id },
      { ts: at(-1, 23, 30), t: "type_from_definition", r: "correct", w: harbor.id },
      { ts: at(-1, 8), t: "type_from_definition", r: "incorrect", w: harbor.id },
      { ts: at(-20, 12), t: "", r: "correct", w: harbor.id }, // "" → "other"
    ];
    for (const a of seed)
      await u.logAttempt({ word_id: a.w, exercise_type: a.t, result: a.r, ts: a.ts });
  });

  it("wordStats matches computeWordStats over all()", async () => {
    const u = store.forUser(U);
    const got = await u.wordStats();
    expect(got).toEqual(computeWordStats(await u.all()));
    // sanity: the interesting values, asserted explicitly
    expect(got.total).toBe(3);
    expect(got.practiced).toBe(2);
    expect(got.mastered).toBe(1);
    expect(got.weak).toBe(1);
    expect(got.stageCounts).toMatchObject({ new: 1, recognition: 1, known: 1 });
    expect(got.topSeen).toEqual([
      { word: "Resilient", times_seen: 6 },
      { word: "harbor", times_seen: 3 },
    ]);
  });

  it("attemptStats matches computeAttemptStats over attempts()", async () => {
    const u = store.forUser(U);
    const now = Date.now();
    const got = await u.attemptStats(now);
    expect(got).toEqual(computeAttemptStats(await u.attempts(), now));
    expect(got.total).toBe(5);
    expect(got.overall).toEqual({ correct: 3, partial: 1, incorrect: 1 });
    expect(got.streak).toBe(2);
    // day-boundary check: yesterday 23:30 + 8:00 → 2 in yesterday's bucket,
    // today 00:30 + 9:00 → 2 in today's; the 20-day-old one is outside.
    const byDay: { total: number }[] = got.byDay;
    expect(byDay).toHaveLength(14);
    expect(byDay[13]).toMatchObject({ total: 2, correct: 1, partial: 1 });
    expect(byDay[12]).toMatchObject({ total: 2, correct: 1, incorrect: 1 });
    expect(byDay.reduce((a, d) => a + d.total, 0)).toBe(4);
    // byType: volume first, ties broken by first appearance (ts order)
    const byType: { type: string }[] = got.byType;
    expect(byType.map((t) => t.type)).toEqual([
      "type_from_definition",
      "other",
      "cloze",
      "flashcard",
    ]);
  });

  it("empty user gets zero-filled stats in the same shape", async () => {
    const empty = store.forUser("nobody-yet");
    const now = Date.now();
    expect(await empty.wordStats()).toEqual(computeWordStats([]));
    expect(await empty.attemptStats(now)).toEqual(computeAttemptStats([], now));
  });
});

describe("lean practice candidates", () => {
  it("hydrates stage `new` for unstudied collection members; practiceWord fetches the full row", async () => {
    const owner = store.forUser(OWNER);
    const learner = store.forUser("learner-2");
    const w = await owner.add({
      word: "surge",
      vi_meaning: "tăng vọt",
      example_simple: "Prices surge in spring.",
    });
    const col = await owner.createCollection({ name: "Pack" });
    await owner.setCollectionVisibility(col.id, "public");
    await owner.setCollectionMembers(col.id, { add: [w.id] });

    // learner studies nothing → no candidates without a collection scope…
    expect(await learner.practiceCandidatesLite()).toEqual([]);
    // …but the public pack's members appear, hydrated as unstudied.
    const cands = await learner.practiceCandidatesLite(col.id);
    expect(cands).toHaveLength(1);
    expect(cands[0]).toEqual({
      id: w.id,
      word: "surge",
      stage: "new",
      times_seen: 0,
      recent_results: [],
      last_seen_at: null,
    }); // lean row: no heavy content columns

    const full = await learner.practiceWord(w.id, col.id);
    expect(full?.vi_meaning).toBe("tăng vọt");
    expect(full?.example_simple).toBe("Prices surge in spring.");
    expect(full?.stage).toBe("new");
    // outside the collection scope the learner doesn't study it → not found
    expect(await learner.practiceWord(w.id)).toBeUndefined();
  });

  it("lean rows carry the user's own progress once studied", async () => {
    const owner = store.forUser(OWNER);
    const [w] = (await owner.all()).filter((x) => x.word === "surge");
    await owner.setProgress(w.id, {
      stage: "recall",
      times_seen: 2,
      recent_results: ["correct"],
      last_seen_at: 123,
    });
    const cands = await owner.practiceCandidatesLite();
    const mine = cands.find((c) => c.id === w.id);
    expect(mine).toMatchObject({
      stage: "recall",
      times_seen: 2,
      recent_results: ["correct"],
      last_seen_at: 123,
    });
  });
});
