#!/usr/bin/env node
// Scan the COPY DB for __system__ words with incomplete content. Zero LLM.
// Emits: gap summary + batch ticket files (~25 words each) to OUT_DIR.
import { createClient } from "@libsql/client";
import { writeFileSync, mkdirSync } from "fs";
import path from "path";

const SYSTEM_OWNER = "__system__";
const url = process.env.DATABASE_URL;
const OUT_DIR = process.env.OUT_DIR || "/tmp/tickets";
const BATCH = Number(process.env.BATCH || 25);

const isBlank = (v) => v == null || String(v).trim() === "" || String(v).trim() === "[]";
const FIELDS = ["difficulty","synonyms","collocations","example_simple","example_complex","definition_en","ipa","part_of_speech"];

const db = createClient({ url });
const rs = await db.execute({
  sql: `SELECT id, word, part_of_speech, ipa, vi_meaning, definition_en, synonyms,
               collocations, example_simple, example_complex, difficulty
        FROM words WHERE owner_id = ? ORDER BY word COLLATE NOCASE`,
  args: [SYSTEM_OWNER],
});

const total = rs.rows.length;
const gap = Object.fromEntries(FIELDS.map(f => [f, 0]));
let needContent = 0;
const tickets = [];

for (const r of rs.rows) {
  const missing = [];
  for (const f of FIELDS) if (isBlank(r[f])) { missing.push(f); gap[f]++; }
  if (missing.length) {
    needContent++;
    tickets.push({
      id: String(r.id),
      word: String(r.word),
      vi_meaning: r.vi_meaning ? String(r.vi_meaning) : "",
      missing,
    });
  }
}

console.log(`Total __system__ words: ${total}`);
console.log(`Words needing any content: ${needContent}`);
console.log("Per-field gaps:");
for (const f of FIELDS) console.log(`  ${f}: ${gap[f]}`);

if (process.env.WRITE === "1") {
  mkdirSync(OUT_DIR, { recursive: true });
  let n = 0;
  for (let i = 0; i < tickets.length; i += BATCH) {
    const batch = tickets.slice(i, i + BATCH);
    n++;
    const fn = path.join(OUT_DIR, `batch-${String(n).padStart(3,"0")}.json`);
    writeFileSync(fn, JSON.stringify(batch, null, 2));
  }
  console.log(`\nWrote ${n} batch files of up to ${BATCH} words to ${OUT_DIR}`);
}
process.exit(0);
