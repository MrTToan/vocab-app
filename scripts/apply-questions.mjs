// Apply a subagent-authored question file to the DB (used by the
// /enrich-questions-bank skill). Reads a JSON file keyed by exact word:
//   { "<word>": { cloze:[{sentence,answer}], translate:[{direction,source}], scenario:["..."] }, ... }
// looks up each word's id from the running app, flattens to question rows, and
// POSTs them to /api/questions/import.
//
// Usage:  node scripts/apply-questions.mjs <path-to-chunk.out.json>
//         BASE_URL=http://localhost:3001 node scripts/apply-questions.mjs <file>

import { readFileSync } from "node:fs";

async function detectBase() {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, "");
  for (const port of [3000, 3001, 3002, 3003]) {
    try {
      const r = await fetch(`http://localhost:${port}/api/config`);
      if (r.ok && (await r.json()).backend) return `http://localhost:${port}`;
    } catch {}
  }
  throw new Error("App not found. Start it (npm run dev) or set BASE_URL.");
}

const file = process.argv[2];
if (!file) throw new Error("pass the chunk .out.json path");
const map = JSON.parse(readFileSync(file, "utf8"));
const B = await detectBase();
const norm = (s) => s.trim().toLowerCase();
const words = (await (await fetch(`${B}/api/words`)).json()).words;
const byWord = new Map(words.map((w) => [norm(w.word), w]));

const rows = [];
let missing = 0;
for (const [word, v] of Object.entries(map)) {
  const w = byWord.get(norm(word));
  if (!w) { missing++; continue; }
  for (const c of v.cloze || [])
    if (c && c.sentence)
      rows.push({ word_id: w.id, type: "cloze", direction: "", payload: c.sentence, answer: c.answer || w.word });
  for (const t of v.translate || [])
    if (t && t.source)
      rows.push({ word_id: w.id, type: "translate", direction: t.direction === "vn_to_en" ? "vn_to_en" : "en_to_vn", payload: t.source, answer: "" });
  for (const s of v.scenario || []) {
    const prompt = typeof s === "string" ? s : s?.prompt || "";
    if (prompt) rows.push({ word_id: w.id, type: "scenario", direction: "", payload: prompt, answer: "" });
  }
}

let added = 0;
for (let i = 0; i < rows.length; i += 300) {
  const r = await fetch(`${B}/api/questions/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questions: rows.slice(i, i + 300) }),
  });
  if (r.ok) added += (await r.json()).added;
  else console.error(`chunk ${i} failed: ${r.status}`);
}
console.log(`applied ${added} questions from ${Object.keys(map).length} words` + (missing ? ` (${missing} words unmatched)` : ""));
