// One-off importer for tracker.csv (the "Dictionary" export).
//
// Your CSV has: col 1 = Word, col 3 = a combined cell holding the Vietnamese
// meaning + "Simple:" / "Complex:" example sentences. This script splits that
// cell into vi_meaning / example_simple / example_complex and imports every row
// WITHOUT calling any LLM (enrich: false). Existing words are skipped.
//
// Usage:
//   1. Start the app in another terminal:  npm run dev
//   2. Run:                                node scripts/import-tracker.mjs
//   (optional)  BASE_URL=http://localhost:3001 node scripts/import-tracker.mjs
//               node scripts/import-tracker.mjs path/to/other.csv
//
// Tip: if you want these words to land in your Google Sheet rather than the
// local file, set up the Sheet first (docs/SETUP-GOOGLE-SHEET.md), then run this.

import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";

const CSV_PATH = process.argv[2] || "tracker.csv";
const CHUNK = 100;

/* ── split one "Meaning" cell into the three fields ── */
function splitMeaning(text) {
  text = (text || "").trim();
  if (!text) return { vi_meaning: "", example_simple: "", example_complex: "" };
  const ms = text.search(/\bsimple\s*:/i);
  const mc = text.search(/\bcomplex\s*:/i);
  if (ms !== -1 || mc !== -1) {
    const first = ms !== -1 ? ms : mc;
    const vi = text.slice(0, first).trim();
    let simple = "";
    let complex = "";
    if (ms !== -1) {
      const end = mc !== -1 && mc > ms ? mc : text.length;
      simple = text.slice(text.indexOf(":", ms) + 1, end).trim();
    }
    if (mc !== -1) complex = text.slice(text.indexOf(":", mc) + 1).trim();
    return { vi_meaning: vi, example_simple: simple, example_complex: complex };
  }
  // no labels: first non-empty line = meaning, then example lines
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return {
    vi_meaning: lines[0] || "",
    example_simple: lines[1] || "",
    example_complex: lines.slice(2).join(" ") || "",
  };
}

/* ── find the running app ── */
async function detectBase() {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, "");
  for (const port of [3000, 3001, 3002, 3003]) {
    try {
      const r = await fetch(`http://localhost:${port}/api/config`);
      if (r.ok) {
        const j = await r.json();
        if (j && j.backend) return `http://localhost:${port}`;
      }
    } catch {
      /* not this port */
    }
  }
  throw new Error(
    "Could not find the running app. Start it with `npm run dev`, or set BASE_URL.",
  );
}

async function main() {
  const raw = readFileSync(CSV_PATH, "utf8");
  const rows = parse(raw, { relax_column_count: true, skip_empty_lines: false });
  const header = rows[0].map((c) => (c || "").trim().toLowerCase());
  let wordCol = header.indexOf("word");
  let meaningCol = header.indexOf("meaning");
  if (wordCol === -1) wordCol = 1;
  if (meaningCol === -1) meaningCol = 3;

  const words = [];
  for (const r of rows.slice(1)) {
    const word = (r[wordCol] || "").trim();
    if (!word) continue;
    words.push({ word, ...splitMeaning(r[meaningCol]), source: "csv" });
  }
  console.log(`Parsed ${words.length} words from ${CSV_PATH}.`);

  const base = await detectBase();
  console.log(`App: ${base}`);
  const cfg = await (await fetch(`${base}/api/config`)).json();
  console.log(`Storage backend: ${cfg.backend}`);

  // skip words already present (case-insensitive), so re-runs are safe
  const existing = new Set(
    (await (await fetch(`${base}/api/words`)).json()).words.map((w) =>
      w.word.trim().toLowerCase(),
    ),
  );
  const fresh = words.filter((w) => !existing.has(w.word.toLowerCase()));
  const skipped = words.length - fresh.length;
  if (skipped) console.log(`Skipping ${skipped} already in the library.`);
  if (fresh.length === 0) {
    console.log("Nothing new to import. Done.");
    return;
  }

  let created = 0;
  for (let i = 0; i < fresh.length; i += CHUNK) {
    const chunk = fresh.slice(i, i + CHUNK);
    const res = await fetch(`${base}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: chunk, enrich: false }),
    });
    if (!res.ok) {
      console.error(`Chunk ${i} failed: ${res.status} ${await res.text()}`);
      break;
    }
    const j = await res.json();
    created += j.created;
    console.log(`  imported ${Math.min(i + CHUNK, fresh.length)}/${fresh.length}…`);
  }
  console.log(`\n✅ Imported ${created} words (no LLM used). Open ${base} to practise.`);
}

main().catch((e) => {
  console.error("Import failed:", e.message);
  process.exit(1);
});
