import { callStructured } from "../providers";
import {
  CRITERION_LABEL,
  ERROR_LABEL,
  type Criterion,
  type WritingPrompt,
  type WritingSubmission,
  type WritingDiscussionMessage,
} from "./types";

/*
 * "Discuss this feedback with the AI." A student opens a thread on ONE feedback
 * card (a criterion band, a coaching point, or an inline correction) and asks
 * follow-up questions; the tutor answers grounded in their actual essay, the
 * prompt, and that specific piece of feedback. Multi-turn: the whole thread so
 * far is replayed each time. Answers are persisted (writing_discussions table).
 */

export const DISCUSS_SYSTEM = `You are a patient, precise IELTS writing tutor talking with a student (English level B1–B2, first language Vietnamese) about ONE specific piece of feedback on an essay they wrote.

- Answer the student's question directly and concretely, grounded in THEIR essay and the specific feedback shown — quote or point to their actual words.
- Justify the feedback when asked "why": explain against IELTS band descriptors, and show a concrete before→after rewrite when it helps.
- Be encouraging but honest; do not inflate their band or contradict the feedback without good reason.
- Keep it focused and fairly short (a few sentences, or a short list). Plain language; you may add a Vietnamese gloss for a hard word in parentheses.
- Stay on this feedback item; if they drift far, gently steer back. Never invent facts about the essay that aren't there.`;

/** Reply is a single markdown-ish string. */
export const WRITING_DISCUSS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { reply: { type: "string" } },
  required: ["reply"],
} as const;

/** Turn a card_key into a human-readable label + detail, resolved from the submission. Pure. */
export function resolveCardContext(
  s: WritingSubmission,
  cardKey: string,
): { label: string; detail: string } | null {
  const [kind, rest] = [cardKey.slice(0, cardKey.indexOf(":")), cardKey.slice(cardKey.indexOf(":") + 1)];

  if (kind === "criterion") {
    const c = rest as Criterion;
    const band = s.bands[c];
    if (!band) return null;
    return {
      label: `Criterion score — ${CRITERION_LABEL[c]}: band ${band.band.toFixed(1)}`,
      detail: `The examiner's comment for this criterion was: "${band.comment}". The overall band was ${s.overall_band.toFixed(1)}.`,
    };
  }

  if (kind === "priority") {
    const p = s.priorities?.[Number(rest)];
    if (!p) return null;
    return {
      label: `Coaching point — ${p.title} (${CRITERION_LABEL[p.criterion]})`,
      detail: `Why it matters: ${p.why}\nHow to improve: ${p.how}${p.example ? `\nSuggested phrasing: ${p.example}` : ""}`,
    };
  }

  if (kind === "correction") {
    const cr = s.corrections?.[Number(rest)];
    if (!cr) return null;
    return {
      label: `Inline correction — "${cr.original}" → "${cr.suggestion}" (${ERROR_LABEL[cr.error_type]})`,
      detail: `The note given was: "${cr.explanation}". This relates to the ${CRITERION_LABEL[cr.criterion]} criterion.`,
    };
  }

  return null;
}

function buildUser(
  prompt: WritingPrompt,
  s: WritingSubmission,
  card: { label: string; detail: string },
  history: WritingDiscussionMessage[],
  question: string,
): string {
  const parts: string[] = [];
  parts.push(`# The writing task (${s.task_type === "task1" ? "IELTS Task 1" : "IELTS Task 2"})\n${prompt.prompt_text}`);
  parts.push(`# The student's essay (${s.word_count} words)\n${s.text}`);
  parts.push(`# The feedback card being discussed\n${card.label}\n${card.detail}`);
  if (history.length) {
    parts.push(
      "# Conversation so far\n" +
        history.map((m) => `${m.role === "user" ? "Student" : "Tutor"}: ${m.content}`).join("\n"),
    );
  }
  parts.push(`# The student's new question\n${question}`);
  parts.push(`Respond as the tutor. Return JSON: { "reply": "<your answer>" }.`);
  return parts.join("\n\n");
}

/** Ask the tutor a question about one feedback card; returns the reply text. */
export async function discussCard(
  prompt: WritingPrompt,
  submission: WritingSubmission,
  cardKey: string,
  history: WritingDiscussionMessage[],
  question: string,
): Promise<string> {
  const card = resolveCardContext(submission, cardKey);
  if (!card) throw new Error(`Unknown feedback card: ${cardKey}`);
  const raw = (await callStructured("discuss-writing", {
    system: DISCUSS_SYSTEM,
    user: buildUser(prompt, submission, card, history, question),
    schema: WRITING_DISCUSS_JSON_SCHEMA,
    maxTokens: 1200,
  })) as { reply?: string };
  const reply = (raw.reply ?? "").trim();
  if (!reply) throw new Error("The tutor returned an empty reply.");
  return reply;
}
