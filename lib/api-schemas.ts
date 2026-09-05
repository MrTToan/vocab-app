import { z } from "zod";
import { EXERCISE_TYPES, STAGES } from "@/lib/types";
import { PROMPT_TEXT_MAX, PROMPT_TITLE_MAX } from "@/lib/writing/types";
import { FEEDBACK_CATEGORIES, FEEDBACK_MESSAGE_MAX, FEEDBACK_PAGE_MAX } from "@/lib/feedback/types";
import {
  CLASS_DESCRIPTION_MAX,
  CLASS_EMOJI_MAX,
  CLASS_NAME_MAX,
  INVITE_EMAIL_MAX,
  INVITE_EMAILS_MAX,
} from "@/lib/classes/types";
import {
  ASSIGNMENT_KINDS,
  ASSIGNMENT_INSTRUCTIONS_MAX,
  ASSIGNMENT_TARGETS_MAX,
  ASSIGNMENT_TITLE_MAX,
} from "@/lib/assignments/types";

/*
 * Zod schemas (zod 4) for every API route, consumed via lib/api.ts. Bodies are
 * `.strict()` (unknown keys -> 400) unless noted; length caps keep abusive
 * payloads out before any DB/LLM work happens:
 *
 *   word 1–100 · vi_meaning/definition/examples/notes <= 2,000
 *   tags/synonyms/collocations <= 50 strings of <= 60 chars
 *   collection name <= 80 / description <= 500 / emoji <= 8
 *   essay text <= 8,000 · discuss message <= 1,000
 *   words[] <= 250 (paste/check-bulk) · rows[] <= 500 (CSV import)
 *   ids: non-empty strings <= 64 · seenIds <= 100
 */

/* ── shared pieces ─────────────────────────────────────────────────── */

export const idSchema = z.string().min(1).max(64);
const shortStr = z.string().max(60);
const longText = z.string().max(2000);
const strArr = z.array(shortStr).max(50);
const wordName = z.string().trim().min(1, "word is required").max(100);
const sourceEnum = z.enum(["csv", "manual", "paste"]);

/** The editable CONTENT fields of a word — never id/owner_id/created_at/stage. */
const wordContentFields = {
  part_of_speech: shortStr.optional(),
  ipa: z.string().max(200).optional(),
  vi_meaning: longText.optional(),
  definition_en: longText.optional(),
  synonyms: strArr.optional(),
  collocations: strArr.optional(),
  example_simple: longText.optional(),
  example_complex: longText.optional(),
  false_friend_note: longText.optional(),
  personal_note: longText.optional(),
  tags: strArr.optional(),
};

export const emptySchema = z.strictObject({});

/* ── words ─────────────────────────────────────────────────────────── */

/**
 * GET /api/words. `fields=list` returns the slim Library page; the paging +
 * filter params (q/stage/collection/limit/offset) are applied SERVER-side by
 * store.listPage so a page is a page (not the whole ~1,200-row list). Query
 * params arrive as strings, so limit/offset are coerced. `stage` accepts the
 * pill values: "all", "weak", or a concrete Stage.
 */
export const wordsQuerySchema = z.strictObject({
  fields: z.string().max(20).optional(),
  q: z.string().max(100).optional(),
  stage: z.enum(["all", "weak", ...STAGES]).optional(),
  collection: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

/** POST /api/words — no client-supplied id/created_at/stage (strict). */
export const createWordSchema = z.strictObject({
  word: wordName,
  ...wordContentFields,
  source: sourceEnum.optional(),
  enrich: z.boolean().optional(),
  allow_duplicate: z.boolean().optional(),
  collectionIds: z.array(idSchema).max(50).optional(),
});

/**
 * PATCH /api/words/[id] — editable content fields only. NON-strict on purpose:
 * unknown keys (the UI's legacy progress-reset payload, id, owner_id, …) are
 * STRIPPED, never applied — which preserves today's SQLite behaviour where the
 * store ignored them anyway.
 */
export const patchWordSchema = z.object({
  word: wordName.optional(),
  ...wordContentFields,
});

export const checkWordQuerySchema = z.strictObject({
  word: z.string().max(100).optional(),
});

export const checkBulkSchema = z.strictObject({
  words: z.array(z.string().max(100), "words is required").max(250),
});

export const importPasteSchema = z.strictObject({
  words: z
    .array(z.string().max(100), "words is required")
    .min(1, "words is required")
    .max(250),
  // Optional collection to tag every imported word into (created new words AND
  // any paste entry that turns out to already exist). Owner-checked server-side.
  collectionId: idSchema.optional(),
});

/**
 * POST /api/words/import-plan — cheap, read-only preview for the paste importer.
 * Lemma-dedupes the pasted list within itself AND against the user's existing
 * words: new words to enrich, existing words to tag, and repeats to skip.
 */
export const importPlanSchema = z.strictObject({
  words: z
    .array(z.string().max(100), "words is required")
    .min(1, "words is required")
    .max(250),
});

/* ── CSV import ────────────────────────────────────────────────────── */

const importRowSchema = z.strictObject({
  word: wordName,
  ...wordContentFields,
  source: sourceEnum.optional(),
});

export const importSchema = z.strictObject({
  rows: z.array(importRowSchema, "rows is required").min(1, "rows is required").max(500),
  enrich: z.boolean().optional(),
});

/* ── enrich ────────────────────────────────────────────────────────── */

export const enrichSchema = z.strictObject({
  word: wordName,
  // learner-known fields to preserve during enrichment; unknown keys stripped
  known: z.object(wordContentFields).optional(),
});

/* ── collections ───────────────────────────────────────────────────── */

const collectionName = z.string().trim().min(1, "name is required").max(80);

export const createCollectionSchema = z.strictObject({
  name: collectionName,
  description: z.string().max(500).optional(),
  emoji: z.string().max(8).optional(),
});

export const patchCollectionSchema = z.strictObject({
  name: collectionName.optional(),
  description: z.string().max(500).optional(),
  emoji: z.string().max(8).optional(),
  visibility: z.enum(["public", "private"]).optional(),
});

export const collectionMembersSchema = z.strictObject({
  add: z.array(idSchema).max(50).optional(),
  remove: z.array(idSchema).max(50).optional(),
});

/* ── practice ──────────────────────────────────────────────────────── */

export const practiceNextSchema = z.strictObject({
  seenIds: z.array(idSchema).max(100).optional(),
  explore: z.boolean().optional(),
  collectionId: idSchema.optional(),
});

export const practiceResultSchema = z.strictObject({
  wordId: idSchema,
  result: z.enum(["correct", "partial", "incorrect"]),
  exerciseType: z.string().max(60).optional(),
});

/** The generated-exercise payload echoed back for scoring (unknown keys stripped). */
const generatedSchema = z.object({
  cloze_sentence: longText.optional(),
  answer: z.string().max(200).optional(),
  translate_direction: z.enum(["en_to_vn", "vn_to_en"]).optional(),
  translate_source: longText.optional(),
  scenario_prompt: longText.optional(),
  mc_options: z.array(z.string().max(200)).max(10).optional(),
  mc_correct_index: z.number().int().optional(),
});

export const practiceScoreSchema = z.strictObject({
  wordId: idSchema,
  exerciseType: z.enum(EXERCISE_TYPES),
  generated: generatedSchema.optional(),
  answer: z.string().max(2000).optional(),
});

/* ── question bank ─────────────────────────────────────────────────── */

export const questionsImportSchema = z.strictObject({
  questions: z
    .array(
      z.strictObject({
        id: idSchema.optional(),
        word_id: idSchema,
        type: z.enum(["cloze", "translate", "scenario"]),
        direction: z.enum(["en_to_vn", "vn_to_en", ""]).optional(),
        payload: z.string().min(1).max(2000),
        answer: z.string().max(200).optional(),
      }),
      "questions required",
    )
    .min(1, "questions required")
    .max(500),
});

/* ── writing ───────────────────────────────────────────────────────── */

export const writingPromptsQuerySchema = z.strictObject({
  task: z.string().max(20).optional(),
  pick: z.string().max(10).optional(),
});

/** GET /api/admin/writing-prompts — optional task filter (search/visibility are
 *  applied client-side over the full admin list). */
export const adminWritingPromptsQuerySchema = z.strictObject({
  task: z.string().max(20).optional(),
});

export const createPromptSchema = z.strictObject({
  task_type: z.string().max(20),
  prompt_text: z
    .string()
    .max(PROMPT_TEXT_MAX, `The question text is too long (max ${PROMPT_TEXT_MAX.toLocaleString()} characters).`),
  title: z
    .string()
    .max(PROMPT_TITLE_MAX, `Title is too long (max ${PROMPT_TITLE_MAX} characters).`)
    .optional(),
  // base64 data URL, <= 1 MB decoded (route re-checks mime/decoded size)
  image: z.string().max(2_000_000).nullable().optional(),
  chart_data: z.record(z.string(), z.unknown()).nullable().optional(),
  // Admin-authored extras: an optional model/sample answer and the publish state
  // (defaults to public — a newly created admin question is published).
  model_answer: z.string().max(PROMPT_TEXT_MAX).nullable().optional(),
  visibility: z.enum(["public", "private"]).optional(),
});

/**
 * PATCH /api/writing/prompts/:id — owner-only. Accepts a publish/visibility flip
 * AND/OR admin content edits (title, prompt_text, task_type, model_answer, and a
 * Task 1 chart image + its transcription). Every field is optional; unknown keys
 * are rejected (strict). The route re-checks image mime/size like create.
 */
export const patchPromptSchema = z
  .strictObject({
    visibility: z.enum(["public", "private"], "visibility must be public or private").optional(),
    task_type: z.string().max(20).optional(),
    title: z
      .string()
      .max(PROMPT_TITLE_MAX, `Title is too long (max ${PROMPT_TITLE_MAX} characters).`)
      .optional(),
    prompt_text: z
      .string()
      .max(PROMPT_TEXT_MAX, `The question text is too long (max ${PROMPT_TEXT_MAX.toLocaleString()} characters).`)
      .optional(),
    model_answer: z.string().max(PROMPT_TEXT_MAX).nullable().optional(),
    // base64 data URL (Task 1 chart), or null to clear it. Route re-checks mime/size.
    image: z.string().max(2_000_000).nullable().optional(),
    chart_data: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: "no fields to update" });

export const discussQuerySchema = z.strictObject({
  submissionId: z.string().min(1, "submissionId required").max(64),
});

export const discussPostSchema = z.strictObject({
  submissionId: z
    .string("submissionId and cardKey required")
    .min(1, "submissionId and cardKey required")
    .max(64),
  cardKey: z
    .string("submissionId and cardKey required")
    .min(1, "submissionId and cardKey required")
    .max(64),
  message: z
    .string()
    .max(1000, "Please keep your question under 1000 characters.")
    .optional(),
});

export const extractChartSchema = z.strictObject({
  // base64 data URL, <= 2 MB decoded (route's imageProblem re-checks precisely)
  image: z.string().max(3_000_000).optional(),
});

/* ── pronunciation (lib/speech/**) ─────────────────────────────────── */

/** POST /api/speech/tts — "hear it". Speak the word, optionally + an example. */
export const speakSchema = z.strictObject({
  word: wordName,
  example: z.string().max(400).optional(),
});

/** POST /api/speech/assess — "say it". `audio` is a base64 data URL of a WAV
 *  clip (16 kHz mono PCM); the route decodes + re-validates the header/size. */
export const assessSchema = z.strictObject({
  word: wordName,
  audio: z.string().max(8_000_000),
});

export const writingSubmitSchema = z.strictObject({
  promptId: z.string().min(1, "promptId required").max(64),
  text: z.string().max(8000).optional(),
});

export const submissionQuerySchema = z.strictObject({
  promptId: z.string().min(1, "promptId required").max(64),
});

/* ── feedback ──────────────────────────────────────────────────────── */

/**
 * POST /api/feedback — the in-app widget. Message is the required long-text
 * field; category defaults to "other"; rating is optional (least-annoying UX —
 * a user with only a comment shouldn't be forced to pick stars). `page` is the
 * in-app path it was sent from (client-supplied, for triage); user-agent is
 * captured server-side, not here. Strict: unknown keys -> 400.
 */
export const createFeedbackSchema = z.strictObject({
  category: z.enum(FEEDBACK_CATEGORIES).default("other"),
  rating: z.coerce.number().int().min(1).max(5).nullish(),
  message: z
    .string()
    .trim()
    .min(1, "Please write a message.")
    .max(
      FEEDBACK_MESSAGE_MAX,
      `Please keep your message under ${FEEDBACK_MESSAGE_MAX.toLocaleString()} characters.`,
    ),
  page: z.string().max(FEEDBACK_PAGE_MAX).optional(),
});

/* ── classes ───────────────────────────────────────────────────────── */

const className = z.string().trim().min(1, "name is required").max(CLASS_NAME_MAX);
const classDescription = z.string().max(CLASS_DESCRIPTION_MAX);
const classEmoji = z.string().max(CLASS_EMOJI_MAX);
// Codes are entered by hand; allow dashes/spaces the store normalizes away.
const joinCode = z.string().trim().min(1, "code is required").max(40);

export const createClassSchema = z.strictObject({
  name: className,
  description: classDescription.optional(),
  emoji: classEmoji.optional(),
});

export const patchClassSchema = z
  .strictObject({
    name: className.optional(),
    description: classDescription.optional(),
    emoji: classEmoji.optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: "no fields to update" });

/** GET /api/classes/join?code= — the consent-screen preview (no write). */
export const joinCodeQuerySchema = z.strictObject({ code: joinCode });

/** POST /api/classes/join — redeem a code (the consent write). */
export const joinClassSchema = z.strictObject({ code: joinCode });

/** POST /api/classes/[id]/invites — invite by email (Slice 3). The store
 *  normalizes/validates each address and drops non-email entries, so the schema
 *  only bounds the batch size and per-entry length; an empty batch is a 400. */
export const createInvitesSchema = z.strictObject({
  emails: z
    .array(z.string().trim().min(1).max(INVITE_EMAIL_MAX))
    .min(1, "enter at least one email")
    .max(INVITE_EMAILS_MAX, `up to ${INVITE_EMAILS_MAX} emails at a time`),
});

/* ── assignments ───────────────────────────────────────────────────── */

const assignmentTitle = z.string().max(ASSIGNMENT_TITLE_MAX);
const assignmentInstructions = z.string().max(ASSIGNMENT_INSTRUCTIONS_MAX);
// Epoch-ms due date; nullable so a patch can clear it. Non-negative int.
const dueAt = z.number().int().min(0).nullable();

/** POST /api/classes/[id]/assignments — create an assignment (teacher-only).
 *  `kind` selects the content adapter; `ref` is the stable content id; `studentIds`
 *  are the specific students to target (the store keeps only real class students). */
export const createAssignmentSchema = z.strictObject({
  kind: z.enum(ASSIGNMENT_KINDS),
  ref: idSchema,
  title: assignmentTitle.optional(),
  instructions: assignmentInstructions.optional(),
  dueAt: dueAt.optional(),
  studentIds: z
    .array(idSchema)
    .min(1, "select at least one student")
    .max(ASSIGNMENT_TARGETS_MAX),
});

/** PATCH /api/assignments/[id] — teacher edits title/instructions/due date. */
export const patchAssignmentSchema = z
  .strictObject({
    title: assignmentTitle.optional(),
    instructions: assignmentInstructions.optional(),
    dueAt: dueAt.optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: "no fields to update" });

/** GET /api/assignments/content?kind=&q= — the teacher's content picker. */
export const assignmentContentQuerySchema = z.strictObject({
  kind: z.enum(ASSIGNMENT_KINDS),
  q: z.string().max(100).optional(),
});
