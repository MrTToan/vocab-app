import { withUser } from "@/lib/api";
import { importSchema } from "@/lib/api-schemas";
import { getStore, normalizeWord, type NewWord } from "@/lib/store";
import { reserveQuota, QuotaError } from "@/lib/auth/quota";
import { enrichWord, hasProvider } from "@/lib/llm";

/**
 * POST { rows: NewWord[], enrich?: boolean }
 * Skips words already in the library and in-batch duplicates, optionally
 * enriches the rest, then writes them. Returns created + skipped counts.
 */
export const POST = withUser(importSchema, async ({ userId, input }) => {
  const { rows, enrich } = input;
  const store = getStore().forUser(userId);

  // dedupe: skip words already stored and repeats within this batch (checked
  // against the library in SQL — no need to load every word)
  const seen = await store.existingWords(rows.map((r) => r.word ?? ""));
  const toAdd: NewWord[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (!row.word?.trim()) continue;
    const n = normalizeWord(row.word);
    if (seen.has(n)) {
      skipped++;
      continue;
    }
    seen.add(n);
    toAdd.push(row);
  }

  const doEnrich = !!enrich && hasProvider("enrich");
  const errors: { word: string; error: string }[] = [];

  const prepared = await mapWithConcurrency(toAdd, 5, async (row) => {
    const base: NewWord = { ...row, source: row.source ?? "csv" };
    if (!doEnrich) return base;
    try {
      await reserveQuota(userId, "enrich"); // per-user daily cap
      const { enrichment: e } = await enrichWord(row.word, row);
      // enrichment fills gaps; learner-supplied non-empty values win
      return { ...e, ...stripEmpty(row), word: row.word, source: "csv" as const };
    } catch (err: unknown) {
      const msg =
        err instanceof QuotaError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      errors.push({ word: row.word, error: msg });
      return base; // save the raw row anyway (un-enriched)
    }
  });

  const created = await store.addMany(prepared);
  return {
    created: created.length,
    skipped,
    errors,
    words: created,
  };
});

function stripEmpty(obj: Record<string, unknown>): Record<string, unknown> {
  const keep: Record<string, unknown> = {};
  for (const k of [
    "part_of_speech",
    "vi_meaning",
    "example_simple",
    "example_complex",
    "personal_note",
    "tags",
  ]) {
    const v = obj[k];
    if (Array.isArray(v) ? v.length : v) keep[k] = v;
  }
  return keep;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
