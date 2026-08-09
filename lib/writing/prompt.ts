import { MIN_WORDS, type WritingPrompt, type WritingTask } from "./types";

/*
 * Builds the scoring system + user prompts (pure, given its inputs). The LLM
 * returns structured JSON (see WRITING_SCORE_JSON_SCHEMA); these strings only
 * shape the grading, they don't parse anything.
 */

export const WRITING_SCORE_SYSTEM = `You are a strict, fair, and consistent IELTS Academic Writing examiner.

Grade the candidate's response on the four official criteria, each on the 0–9 band scale (whole or .5):
- task_achievement: does it fully address the task with a clear position and well-developed, relevant ideas? (Task 1: accurate overview + key features/data, no invented data.)
- coherence_cohesion: logical organisation, paragraphing, and cohesive devices used naturally.
- lexical_resource: range, precision, and appropriacy of vocabulary and collocation.
- grammatical_range_accuracy: range of structures and grammatical/punctuation accuracy.

Then give an overall_band (the usual IELTS average of the four, rounded to the nearest half).

Corrections: list the most impactful errors and improvements (aim for 6–15, not every tiny slip). For each:
- "original" MUST be an EXACT substring copied verbatim from the candidate's text (same case, spacing and spelling) so it can be highlighted — never paraphrase it.
- "suggestion" is the corrected or upgraded wording.
- "error_type" is one of: article, tense, subject_verb_agreement, preposition, collocation, word_choice, spelling, punctuation, sentence_structure, cohesion, register, task_response, other.
- "criterion" is the criterion it most affects (task_achievement, coherence_cohesion, lexical_resource, grammatical_range_accuracy).
- "explanation" is one concise sentence a B1–B2 learner understands.

Also give 2–4 genuine "strengths" and a short "general_feedback" paragraph with the single highest-priority thing to improve. Be encouraging but honest; do not inflate bands.`;

export function writingScoreUser(
  prompt: WritingPrompt,
  task: WritingTask,
  text: string,
  wordCount: number,
  guidance: string,
): string {
  const min = MIN_WORDS[task];
  const parts: string[] = [];

  parts.push(`# Task type\nIELTS Academic Writing ${task === "task1" ? "Task 1 (describe the chart/graph/diagram)" : "Task 2 (essay)"}`);
  parts.push(`# Prompt\n${prompt.prompt_text}`);

  if (task === "task1" && prompt.chart_data) {
    // Ground truth read once at ingest — score data accuracy against THIS, not a
    // fresh reading of the image.
    parts.push(
      `# Chart data (ground truth — the candidate should report these accurately)\n${JSON.stringify(
        prompt.chart_data,
        null,
        2,
      )}`,
    );
  }

  if (guidance.trim()) {
    parts.push(
      `# Additional grading guidance from the teacher (apply these rules)\n${guidance.trim()}`,
    );
  }

  parts.push(
    `# Length\nMinimum expected: ${min} words. Candidate wrote: ${wordCount} words.${
      wordCount < min ? " This is UNDER the minimum — penalise task_achievement accordingly." : ""
    }`,
  );

  parts.push(`# Candidate's response\n"""\n${text}\n"""`);

  return parts.join("\n\n");
}
