import { createHash } from "crypto";
import type { Question } from "./types";
import { toCloze } from "./cloze";

/**
 * Recycle the good English we already pay the LLM for — model corrections,
 * live-generated exercises, enrichment examples — into stored bank questions, so
 * the question bank self-refills from normal use instead of being discarded.
 *
 * Ids are deterministic (hash of word_id + type + payload) so re-harvesting the
 * same sentence can't create duplicate rows — `store.addQuestions` uses
 * INSERT OR REPLACE keyed on id, so a repeat is a harmless no-op.
 */

type Harvestable = Question | null;

function qid(word_id: string, type: string, payload: string): string {
  return createHash("sha1")
    .update(`${word_id}|${type}|${payload.trim().toLowerCase()}`)
    .digest("hex");
}

/** Cloze from a full English sentence (blanks the word). Null if the word isn't present. */
export function clozeFromSentence(
  word_id: string,
  word: string,
  sentence: string,
): Harvestable {
  const c = toCloze(sentence, word);
  if (!c) return null;
  return {
    id: qid(word_id, "cloze", c.payload),
    word_id,
    type: "cloze",
    direction: "",
    payload: c.payload,
    answer: c.answer,
  };
}

/** Cloze from an already-blanked sentence (e.g. a live-generated cloze_sentence). */
export function clozeRaw(
  word_id: string,
  payload: string,
  answer: string,
): Harvestable {
  const p = (payload ?? "").trim();
  if (!p.includes("____")) return null;
  return {
    id: qid(word_id, "cloze", p),
    word_id,
    type: "cloze",
    direction: "",
    payload: p,
    answer: (answer ?? "").trim(),
  };
}

export function translateQuestion(
  word_id: string,
  direction: "en_to_vn" | "vn_to_en",
  source: string,
): Harvestable {
  const s = (source ?? "").trim();
  if (!s) return null;
  return {
    id: qid(word_id, "translate", s),
    word_id,
    type: "translate",
    direction,
    payload: s,
    answer: "",
  };
}

export function scenarioQuestion(word_id: string, prompt: string): Harvestable {
  const p = (prompt ?? "").trim();
  if (!p) return null;
  return {
    id: qid(word_id, "scenario", p),
    word_id,
    type: "scenario",
    direction: "",
    payload: p,
    answer: "",
  };
}

/**
 * Store harvested questions WITHOUT blocking the response — drops nulls, and
 * swallows errors (harvesting is a bonus, never worth failing a request over).
 */
export function saveHarvest(
  store: { addQuestions(qs: Question[]): Promise<void> },
  items: Harvestable[],
): void {
  const real = items.filter((q): q is Question => q !== null);
  if (!real.length) return;
  void store.addQuestions(real).catch(() => {});
}
