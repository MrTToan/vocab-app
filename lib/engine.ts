import {
  STAGES,
  type Stage,
  type Result,
  type Word,
  type ExerciseType,
} from "./types";

const DAY_MS = 86_400_000;
/** A word masters (→ "known") after this many non-incorrect answers in a row.
 * 4 means a word reaches Production and does one write/translate/scenario rep
 * before graduating (3 would let it master before any production exercise). */
const STREAK_TO_MASTER = 4;

/* ───────────────────────────  Signals  ─────────────────────────── */

/** Rolling accuracy over recent_results (correct=1, partial=0.5, incorrect=0). */
export function recentAccuracy(w: Pick<Word, "recent_results">): number {
  const r = w.recent_results;
  if (r.length === 0) return 0;
  const sum = r.reduce(
    (a, x) => a + (x === "correct" ? 1 : x === "partial" ? 0.5 : 0),
    0,
  );
  return sum / r.length;
}

/* ───────────────────────  Stage ladder  ─────────────────────────── */

/** Which exercise to present for a word at a given stage. */
export function exerciseForStage(stage: Stage): ExerciseType {
  switch (stage) {
    case "new":
      return "flashcard";
    case "recognition":
      return "cloze";
    case "recall":
      return "type_from_definition";
    case "production":
    case "known":
      return pickOne(["write_sentence", "translate", "scenario"]);
  }
}

interface Progress {
  stage: Stage;
  times_seen: number;
  recent_results: Result[];
  last_seen_at: number | null;
}

/** Apply a graded result to a word's progress. Pure — returns new progress. */
export function applyResult(
  w: Progress,
  result: Result,
  now: number,
): Progress {
  const recent_results = [...w.recent_results, result].slice(-5);
  const times_seen = w.times_seen + 1;
  const idx = STAGES.indexOf(w.stage);
  const PRODUCTION_INDEX = STAGES.indexOf("production");

  // A short run of non-incorrect answers (near-misses/"partial" count) masters
  // the word from any stage — so words you clearly know retire from rotation.
  const tail = recent_results.slice(-STREAK_TO_MASTER);
  const streakMastered =
    tail.length === STREAK_TO_MASTER && tail.every((r) => r !== "incorrect");

  let stage: Stage;
  if (result === "incorrect") {
    stage = STAGES[Math.max(idx - 1, 0)]; // a wrong answer drops one rung
  } else if (streakMastered || w.stage === "known") {
    stage = "known";
  } else {
    // correct or partial: climb one rung, capped at "production" — only the
    // streak above promotes to "known" (else a single correct at production
    // would master instantly).
    stage = STAGES[Math.min(idx + 1, PRODUCTION_INDEX)];
  }

  return { stage, times_seen, recent_results, last_seen_at: now };
}

/* ───────────────────────  Weighted picker  ──────────────────────── */

/** Selection weight for a word. Higher = more likely to be surfaced. */
export function weightFor(w: Word, now: number): number {
  const acc = recentAccuracy(w);
  const last = w.recent_results[w.recent_results.length - 1];
  const staleDays = w.last_seen_at ? (now - w.last_seen_at) / DAY_MS : Infinity;

  let weight = 1;
  if (last === "incorrect") weight += 3; // weak words first
  if (acc < 0.6 && w.recent_results.length > 0) weight += 2;
  if (staleDays > 3) weight += 1.5; // cheap spacing (also boosts brand-new)
  if (w.stage === "known") weight -= 4; // mastered words fade
  return Math.max(weight, 0.1);
}

/** How many words to keep in active rotation before introducing new ones. */
export const TARGET_ACTIVE = 35;

/**
 * Pick the next word. Keeps a small "active working set": it cycles words you've
 * started (so they climb New→Recognition→Recall→… within one session, giving
 * varied exercises) and only introduces a brand-new word when the active set is
 * below target. `recent` is a short sliding window of just-seen ids so the same
 * word isn't shown back-to-back.
 */
export function pickNext(
  words: Word[],
  now: number,
  recent: ReadonlySet<string>,
  rand: () => number = Math.random,
  opts: { explore?: boolean } = {},
): Word | null {
  if (words.length === 0) return null;
  let eligible = words.filter((w) => !recent.has(w.id));
  if (eligible.length === 0) eligible = words; // all in cooldown -> allow repeats

  const active = eligible.filter((w) => w.times_seen > 0 && w.stage !== "known");
  const fresh = eligible.filter((w) => w.times_seen === 0);

  // Explore mode (user-triggered "new words"): surface a random word you haven't
  // started yet, so the rotation isn't stuck on the active working set. If every
  // word has been started, fall back to any not-recently-seen word.
  if (opts.explore) {
    const pool = fresh.length ? fresh : eligible;
    return pool[Math.floor(rand() * pool.length)];
  }

  let pool: Word[];
  if (active.length && (active.length >= TARGET_ACTIVE || fresh.length === 0)) {
    pool = active; // enough in flight (or nothing new left): keep climbing them
  } else if (active.length && fresh.length) {
    pool = rand() < 0.5 ? active : fresh; // grow the set, but keep reviewing
  } else {
    pool = fresh.length ? fresh : eligible; // fresh start
  }

  const weights = pool.map((w) => weightFor(w, now));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/* ───────────────────────────  collections  ──────────────────────── */

/**
 * Restrict a word list to a collection's members (by id). Pure — the practice
 * route calls this before `pickNext` so the whole stage ladder / working-set
 * picker runs over just the chosen collection, unchanged.
 */
export function scopeToCollection(
  words: Word[],
  memberIds: ReadonlySet<string>,
): Word[] {
  return words.filter((w) => memberIds.has(w.id));
}

/* ───────────────────────────  helpers  ──────────────────────────── */

function pickOne<T>(arr: T[], rand: () => number = Math.random): T {
  return arr[Math.floor(rand() * arr.length)];
}

/** Count words by stage — for the little dashboard. */
export function stageCounts(words: Word[]): Record<Stage, number> {
  const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<
    Stage,
    number
  >;
  for (const w of words) counts[w.stage]++;
  return counts;
}
