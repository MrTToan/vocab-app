// Print the full question bank for one word, nicely formatted.
// Usage:  node scripts/show-questions.mjs <word>
//   e.g.  node scripts/show-questions.mjs reindeer
//
// Reads the local SQLite DB directly (.data/lexi.db) — no server needed.

import { createClient } from "@libsql/client";

const word = process.argv.slice(2).join(" ").trim();
if (!word) {
  console.error("usage: node scripts/show-questions.mjs <word>");
  process.exit(1);
}

const db = createClient({ url: "file:.data/lexi.db" });

const w = await db.execute({
  sql: "SELECT id, word, vi_meaning FROM words WHERE lower(word)=lower(?)",
  args: [word],
});
if (!w.rows.length) {
  console.error(`Not found: "${word}". Check spelling (it must match a stored word).`);
  process.exit(1);
}
const { id, word: term, vi_meaning } = w.rows[0];

const q = await db.execute({
  sql: "SELECT type, direction, payload, answer FROM questions WHERE word_id=? ORDER BY type",
  args: [id],
});

const byType = {};
for (const r of q.rows) (byType[r.type] ||= []).push(r);

console.log(`\n${term}  —  ${vi_meaning}`);
console.log(`${q.rows.length} questions\n`);

const labels = { cloze: "CLOZE (fill the blank)", translate: "TRANSLATE", scenario: "SCENARIO (write a sentence)" };
for (const t of ["cloze", "translate", "scenario"]) {
  const rows = byType[t] || [];
  console.log(`── ${labels[t]} · ${rows.length} ──`);
  rows.forEach((r, i) => {
    const n = String(i + 1).padStart(2, " ");
    if (t === "cloze") console.log(`${n}. ${r.payload}   → ${r.answer}`);
    else if (t === "translate") console.log(`${n}. [${r.direction}] ${r.payload}`);
    else console.log(`${n}. ${r.payload}`);
  });
  console.log();
}
