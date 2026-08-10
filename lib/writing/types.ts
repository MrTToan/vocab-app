import { z } from "zod";

/*
 * Writing module domain + LLM I/O. IELTS Academic Task 1 (chart description) and
 * Task 2 (essay). Feedback is one-shot: four criteria bands + inline corrections.
 */

export const WRITING_TASKS = ["task1", "task2"] as const;
export type WritingTask = (typeof WRITING_TASKS)[number];

/** Minimum word count IELTS expects per task. */
export const MIN_WORDS: Record<WritingTask, number> = { task1: 150, task2: 250 };

/** Recommended minutes to spend per task (the exam gives 60 min total). */
export const REC_MINUTES: Record<WritingTask, number> = { task1: 20, task2: 40 };

/** The four official IELTS writing criteria (our internal keys). */
export const CRITERIA = [
  "task_achievement",
  "coherence_cohesion",
  "lexical_resource",
  "grammatical_range_accuracy",
] as const;
export type Criterion = (typeof CRITERIA)[number];

export const CRITERION_LABEL: Record<Criterion, string> = {
  task_achievement: "Task Achievement",
  coherence_cohesion: "Coherence & Cohesion",
  lexical_resource: "Lexical Resource",
  grammatical_range_accuracy: "Grammar",
};

/** Fixed error taxonomy — drives the inline tags and the error-review report. */
export const ERROR_TYPES = [
  "article",
  "tense",
  "subject_verb_agreement",
  "preposition",
  "collocation",
  "word_choice",
  "spelling",
  "punctuation",
  "sentence_structure",
  "cohesion",
  "register",
  "task_response",
  "other",
] as const;
export type ErrorType = (typeof ERROR_TYPES)[number];

export const ERROR_LABEL: Record<ErrorType, string> = {
  article: "Article",
  tense: "Tense",
  subject_verb_agreement: "Subject–verb agreement",
  preposition: "Preposition",
  collocation: "Collocation",
  word_choice: "Word choice",
  spelling: "Spelling",
  punctuation: "Punctuation",
  sentence_structure: "Sentence structure",
  cohesion: "Cohesion",
  register: "Register / tone",
  task_response: "Task response",
  other: "Other",
};

/* ───────────────────────── stored records ───────────────────────── */

/** Chart data extracted ONCE at ingest (Task 1 only) and reused for scoring. */
export interface ChartData {
  chart_type?: string;
  overview?: string;
  series?: unknown;
  key_trends?: string[];
  [k: string]: unknown;
}

export interface WritingPrompt {
  id: string;
  task_type: WritingTask;
  title: string;
  prompt_text: string;
  image_path: string | null; // Task 1 chart image (served from /public)
  chart_data: ChartData | null; // Task 1 only — ground truth for scoring
  model_answer: string | null;
  source_file: string | null;
  tags: string[];
  created_at: number;
}

/** A located inline correction (start/end are offsets into the submission text). */
export interface WritingCorrection {
  id?: string;
  submission_id?: string;
  original: string;
  suggestion: string;
  error_type: ErrorType;
  criterion: Criterion;
  explanation: string;
  start: number | null; // null if the original span couldn't be located
  end: number | null;
}

export interface CriterionScore {
  band: number;
  comment: string;
}

/** A higher-order coaching point — what to seriously improve to raise the band. */
export interface WritingPriority {
  criterion: Criterion;
  title: string; // short actionable label
  why: string; // what is holding the score back, specific to this response
  how: string; // concrete technique/steps to fix it
  example: string; // a short model phrase/sentence to emulate ("" if none)
}

export interface WritingSubmission {
  id: string;
  prompt_id: string;
  task_type: WritingTask;
  text: string;
  word_count: number;
  overall_band: number;
  bands: Record<Criterion, CriterionScore>;
  strengths: string[];
  general_feedback: string;
  priorities: WritingPriority[];
  corrections: WritingCorrection[];
  created_at: number;
}

/* ───────────────────────── LLM output schema ─────────────────────── */
// Kept lenient (bands as numbers, error_type/criterion as free strings) so a
// slightly-off model response is normalized in grade.ts rather than rejected.

const CriterionOut = z.object({ band: z.number(), comment: z.string() });

export const WritingScoreSchema = z.object({
  overall_band: z.number(),
  criteria: z.object({
    task_achievement: CriterionOut,
    coherence_cohesion: CriterionOut,
    lexical_resource: CriterionOut,
    grammatical_range_accuracy: CriterionOut,
  }),
  corrections: z.array(
    z.object({
      original: z.string(),
      suggestion: z.string(),
      error_type: z.string(),
      criterion: z.string(),
      explanation: z.string(),
    }),
  ),
  strengths: z.array(z.string()),
  general_feedback: z.string(),
  priorities: z.array(
    z.object({
      criterion: z.string(),
      title: z.string(),
      why: z.string(),
      how: z.string(),
      example: z.string(),
    }),
  ),
});
export type WritingScoreRaw = z.infer<typeof WritingScoreSchema>;

/** JSON schema handed to the provider layer (Anthropic/OpenAI structured output). */
export const WRITING_SCORE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    overall_band: { type: "number" },
    criteria: {
      type: "object",
      additionalProperties: false,
      properties: {
        task_achievement: criterionJson(),
        coherence_cohesion: criterionJson(),
        lexical_resource: criterionJson(),
        grammatical_range_accuracy: criterionJson(),
      },
      required: [...CRITERIA],
    },
    corrections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          original: { type: "string" },
          suggestion: { type: "string" },
          error_type: { type: "string", enum: [...ERROR_TYPES] },
          criterion: { type: "string", enum: [...CRITERIA] },
          explanation: { type: "string" },
        },
        required: ["original", "suggestion", "error_type", "criterion", "explanation"],
      },
    },
    strengths: { type: "array", items: { type: "string" } },
    general_feedback: { type: "string" },
    priorities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          criterion: { type: "string", enum: [...CRITERIA] },
          title: { type: "string" },
          why: { type: "string" },
          how: { type: "string" },
          example: { type: "string" },
        },
        required: ["criterion", "title", "why", "how", "example"],
      },
    },
  },
  required: ["overall_band", "criteria", "corrections", "strengths", "general_feedback", "priorities"],
} as const;

function criterionJson() {
  return {
    type: "object",
    additionalProperties: false,
    properties: { band: { type: "number" }, comment: { type: "string" } },
    required: ["band", "comment"],
  };
}
