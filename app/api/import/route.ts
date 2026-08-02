import { NextResponse } from "next/server";
import { getStore, normalizeWord, type NewWord } from "@/lib/store";
import { enrichWord, hasProvider } from "@/lib/llm";

/**
 * POST { rows: NewWord[], enrich?: boolean }
 * Skips words already in the library and in-batch duplicates, optionally
 * enriches the rest, then writes them. Returns created + skipped counts.
 */
export async function POST(req: Request) {
  const { rows, enrich } = (await req.json()) as {
    rows: NewWord[];
    enrich?: boolean;
  };
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "rows is required" }, { status: 400 });
  }

  const store = getStore();

  // dedupe: skip words already stored and repeats within this batch
  const seen = new Set((await store.all()).map((w) => normalizeWord(w.word)));
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
      const { enrichment: e } = await enrichWord(row.word, row);
      // enrichment fills gaps; learner-supplied non-empty values win
      return { ...e, ...stripEmpty(row), word: row.word, source: "csv" as const };
    } catch (err: any) {
      errors.push({ word: row.word, error: err?.message ?? String(err) });
      return base; // save the raw row anyway
    }
  });

  const created = await store.addMany(prepared);
  return NextResponse.json({
    created: created.length,
    skipped,
    errors,
    words: created,
  });
}

function stripEmpty(obj: Record<string, any>): Record<string, any> {
  const keep: Record<string, any> = {};
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
