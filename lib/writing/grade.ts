import {
  CRITERIA,
  ERROR_TYPES,
  type Criterion,
  type ErrorType,
  type WritingCorrection,
  type WritingPriority,
  type WritingScoreRaw,
  type CriterionScore,
} from "./types";

/*
 * Pure helpers for the writing module — no I/O, no LLM. Everything here is unit-
 * tested (tests/writing.test.ts). Grading itself is done by the LLM; this file
 * normalizes and locates its output so the UI can render it reliably.
 */

/** IELTS word count: whitespace-separated tokens containing a letter or digit. */
export function countWords(text: string): number {
  const m = text.trim().match(/[^\s]*[\p{L}\p{N}][^\s]*/gu);
  return m ? m.length : 0;
}

/** Clamp to the IELTS 0–9 scale and round to the nearest half band. */
export function clampBand(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const r = Math.round(n * 2) / 2;
  return Math.max(0, Math.min(9, r));
}

const ERROR_SET = new Set<string>(ERROR_TYPES);
const CRITERION_SET = new Set<string>(CRITERIA);

export function normalizeErrorType(s: string): ErrorType {
  const k = s.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (ERROR_SET.has(k) ? k : "other") as ErrorType;
}

export function normalizeCriterion(s: string): Criterion {
  const k = s.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (CRITERION_SET.has(k) ? k : "task_achievement") as Criterion;
}

/**
 * Assign each correction a character span in `text` by finding its `original`
 * substring. Duplicates are matched left-to-right without reusing a span, so two
 * corrections targeting the same word land on different occurrences. A span that
 * can't be found gets {start:null, end:null} (shown in a list instead of inline).
 */
export function locateCorrections(
  text: string,
  corrections: { original: string; suggestion: string; error_type: string; criterion: string; explanation: string }[],
): WritingCorrection[] {
  const used: [number, number][] = [];
  const lower = text.toLowerCase();

  const findFree = (needle: string): [number, number] | null => {
    if (!needle) return null;
    for (const hay of [text, lower]) {
      const n = hay === text ? needle : needle.toLowerCase();
      let from = 0;
      while (from <= hay.length) {
        const i = hay.indexOf(n, from);
        if (i === -1) break;
        const span: [number, number] = [i, i + n.length];
        if (!used.some(([s, e]) => i < e && span[1] > s)) return span;
        from = i + 1;
      }
    }
    return null;
  };

  return corrections.map((c) => {
    const span = findFree(c.original);
    if (span) used.push(span);
    return {
      original: c.original,
      suggestion: c.suggestion,
      error_type: normalizeErrorType(c.error_type),
      criterion: normalizeCriterion(c.criterion),
      explanation: c.explanation,
      start: span ? span[0] : null,
      end: span ? span[1] : null,
    };
  });
}

/** Normalize a raw LLM score into clean bands + located corrections. */
export function normalizeScore(
  raw: WritingScoreRaw,
  text: string,
): {
  overall_band: number;
  bands: Record<Criterion, CriterionScore>;
  corrections: WritingCorrection[];
  strengths: string[];
  general_feedback: string;
  priorities: WritingPriority[];
} {
  const bands = {} as Record<Criterion, CriterionScore>;
  for (const c of CRITERIA) {
    bands[c] = {
      band: clampBand(raw.criteria[c].band),
      comment: raw.criteria[c].comment,
    };
  }
  return {
    overall_band: clampBand(raw.overall_band),
    bands,
    corrections: locateCorrections(text, raw.corrections),
    strengths: raw.strengths,
    general_feedback: raw.general_feedback,
    priorities: (raw.priorities ?? []).map((p) => ({
      criterion: normalizeCriterion(p.criterion),
      title: p.title,
      why: p.why,
      how: p.how,
      example: p.example,
    })),
  };
}

/** Count corrections by error type (for the review/report). Descending. */
export function aggregateErrors(
  corrections: { error_type: ErrorType }[],
): { error_type: ErrorType; count: number }[] {
  const counts = new Map<ErrorType, number>();
  for (const c of corrections) {
    counts.set(c.error_type, (counts.get(c.error_type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([error_type, count]) => ({ error_type, count }))
    .sort((a, b) => b.count - a.count);
}
