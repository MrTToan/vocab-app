import { randomUUID } from "crypto";
import { withOwner } from "@/lib/api";
import { questionsImportSchema } from "@/lib/api-schemas";
import { getStore } from "@/lib/store";
import type { Question } from "@/lib/types";

/**
 * POST { questions: Question[] } -> inserts into the SHARED question bank.
 * Owner-only (withOwner): the bank is global content every learner practises
 * from, and this endpoint does INSERT OR REPLACE by id, so it exists solely for
 * the owner's ingest tooling (`scripts/apply-questions.mjs`, the
 * enrich-questions-bank skill). Everyone else gets 403 — a learner's own
 * practice feeds the bank only through the server-generated harvest path
 * (`lib/harvest.ts`).
 */
export const POST = withOwner(
  questionsImportSchema,
  async ({ userId, input }) => {
    const rows: Question[] = input.questions.map((q) => ({
      id: q.id || randomUUID(),
      word_id: q.word_id,
      type: q.type,
      direction: q.direction || "",
      payload: q.payload,
      answer: q.answer || "",
    }));
    await getStore().forUser(userId).addQuestions(rows);
    return { added: rows.length };
  },
  // Owner tooling batches up to 500 rows -> allow a larger JSON body.
  { maxBytes: 2 * 1024 * 1024 },
);
