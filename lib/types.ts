import { z } from "zod";

/* ─────────────────────────────  Core domain  ───────────────────────────── */

export const STAGES = [
  "new",
  "recognition",
  "recall",
  "production",
  "known",
] as const;
export type Stage = (typeof STAGES)[number];

export type Result = "correct" | "partial" | "incorrect";

/** Exercise types available in the MVP. Listening/dictation is Phase 2. */
export const EXERCISE_TYPES = [
  "multiple_choice", // warm-up, first exposure only
  "flashcard", // 2-way VN <-> EN, self-graded
  "cloze", // fill-in-the-blank
  "type_from_definition", // given VN/EN meaning -> type the word
  "write_sentence", // LLM-scored
  "translate", // LLM-scored, both directions
  "scenario", // LLM-scored register/tone
] as const;
export type ExerciseType = (typeof EXERCISE_TYPES)[number];

/** Exercises whose answers are graded by the LLM. */
export const LLM_SCORED: ExerciseType[] = [
  "write_sentence",
  "translate",
  "scenario",
];

/** A pre-generated question in a word's bank (so practice doesn't repeat). */
export interface Question {
  id: string;
  word_id: string;
  type: "cloze" | "translate" | "scenario";
  direction: string; // translate: "en_to_vn" | "vn_to_en"; else ""
  payload: string; // cloze sentence (with ____) | translate source | scenario prompt
  answer: string; // cloze: the exact word form that fills the blank; else ""
}

/** One graded practice attempt, logged for the progress page. */
export interface Attempt {
  word_id: string;
  exercise_type: string;
  result: Result;
  ts: number; // epoch ms
}

export interface Word {
  id: string;
  word: string;
  part_of_speech: string;
  ipa: string;
  vi_meaning: string;
  definition_en: string;
  synonyms: string[];
  collocations: string[];
  example_simple: string;
  example_complex: string;
  false_friend_note: string;
  personal_note: string;
  tags: string[];
  source: "csv" | "manual" | "paste";
  // content ownership — `__system__` for the shared/public catalog, or a user id
  // for that user's personal word. Gates EDITING only; content is otherwise
  // global (studying a word grants no edit rights). See lib/auth/user.ts.
  owner_id: string;
  // progress (per-user; hydrated from `user_words` at the store/API boundary
  // before the pure engine ever sees a Word — the engine stays content-agnostic).
  stage: Stage;
  times_seen: number;
  recent_results: Result[]; // most recent last, capped at 5
  last_seen_at: number | null; // epoch ms
  created_at: number;
}

/** The per-user progress a Word carries — the fields hydrated from `user_words`. */
export type Progress = Pick<
  Word,
  "stage" | "times_seen" | "recent_results" | "last_seen_at"
>;

/**
 * The slim word shape the Library LIST view needs: enough to render a row and
 * drive search (word/meaning/tags), the stage/weak filters and the accuracy %.
 * The heavy fields (definition, examples, notes, synonyms, collocations) are
 * loaded on demand via GET /api/words/[id] only when a row is expanded to edit.
 */
export type WordListItem = Pick<
  Word,
  | "id"
  | "word"
  | "ipa"
  | "vi_meaning"
  | "tags"
  | "stage"
  | "times_seen"
  | "recent_results"
  | "created_at"
> & {
  // Whether THIS user already studies the word (has a `user_words` row). Always
  // true in the plain library list; a collection-filtered page can include
  // members the user does not yet study (studying === false) so the Library can
  // offer an "add to my studying" action. See store.listPage().
  studying: boolean;
};

/**
 * A named, curated group of words (many-to-many via a join table). A study
 * "lens", not a separate progress track: picking a collection on /practice
 * scopes the picker to its members, but a word's stage stays global — so
 * drilling a word inside a collection advances it everywhere.
 */
export type Visibility = "public" | "private";

export interface Collection {
  id: string;
  name: string;
  description: string;
  emoji: string;
  created_at: number;
  // `owner_id` is the collection's owner (`__system__` for a public/system pack);
  // `visibility` decides whether other users see and can study it. A public
  // collection's words are the shared catalog; adopting one creates the studier's
  // `user_words` progress rows but copies no content.
  owner_id: string;
  visibility: Visibility;
  count?: number; // member word count, populated by store.collections()
  mine?: boolean; // true when the current caller owns/can edit it (populated by store)
}

/** The enrichable fields the LLM fills. Everything else is app-managed. */
export type EnrichableFields = Pick<
  Word,
  | "part_of_speech"
  | "ipa"
  | "vi_meaning"
  | "definition_en"
  | "synonyms"
  | "collocations"
  | "example_simple"
  | "example_complex"
  | "false_friend_note"
>;

/* ─────────────────────────────  LLM I/O schemas  ────────────────────────── */

export const EnrichmentSchema = z.object({
  part_of_speech: z.string(),
  ipa: z.string(),
  vi_meaning: z.string(),
  definition_en: z.string(),
  synonyms: z.array(z.string()),
  collocations: z.array(z.string()),
  example_simple: z.string(),
  example_complex: z.string(),
  false_friend_note: z.string(),
});
export type Enrichment = z.infer<typeof EnrichmentSchema>;

export const ScoreSchema = z.object({
  verdict: z.enum(["pass", "partial", "fail"]),
  score: z.number(), // 0..100
  reason: z.string(), // one-line why
  correction: z.string(), // corrected/model version ("" if none needed)
  naturalness_note: z.string(), // register / naturalness comment ("" if n/a)
});
export type Score = z.infer<typeof ScoreSchema>;

export function scoreToResult(verdict: Score["verdict"]): Result {
  return verdict === "pass"
    ? "correct"
    : verdict === "partial"
      ? "partial"
      : "incorrect";
}

/** A dynamically generated exercise sent to the client. */
export const GeneratedExerciseSchema = z.object({
  // cloze
  cloze_sentence: z.string().optional(), // sentence with the word replaced by "____"
  answer: z.string().optional(), // expected fill for cloze (exact word form)
  // translate
  translate_direction: z.enum(["en_to_vn", "vn_to_en"]).optional(),
  translate_source: z.string().optional(), // the sentence to translate
  // scenario
  scenario_prompt: z.string().optional(), // situation + tone the learner must satisfy
  // multiple_choice
  mc_options: z.array(z.string()).optional(), // 4 VN meanings, one correct
  mc_correct_index: z.number().optional(),
});
export type GeneratedExercise = z.infer<typeof GeneratedExerciseSchema>;
