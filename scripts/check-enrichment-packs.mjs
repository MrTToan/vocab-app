#!/usr/bin/env node
/*
 * Validate authored enrichment packs under content/enrichment/ against the ticket batches.
 * Zero LLM. Reports, per batch: coverage (every ticket id present), field coverage (every
 * `missing` field authored), and malformed values. Non-zero exit if any hard problem.
 *
 *   TICKET_DIR=/path/to/tickets node scripts/check-enrichment-packs.mjs
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import path from "path";

const ROOT = process.cwd();
const PACK_DIR = process.env.PACK_DIR || path.join(ROOT, "content", "enrichment");
const TICKET_DIR = process.env.TICKET_DIR;
if (!TICKET_DIR) { console.error("set TICKET_DIR"); process.exit(2); }

const IELTS_BANDS = new Set(["5.0", "6.0", "7.0", "8.0", "9.0"]);
const ARRAY_FIELDS = new Set(["synonyms", "collocations"]);
const nz = (v) => v != null && String(v).trim() !== "";

const tickets = readdirSync(TICKET_DIR).filter((f) => /^batch-\d+\.json$/.test(f)).sort();
let hardErr = 0, missingBatches = [], totalTickets = 0, totalAuthored = 0;
const problems = [];

for (const tf of tickets) {
  const base = tf; // batch-NNN.json
  const packPath = path.join(PACK_DIR, base);
  const batch = JSON.parse(readFileSync(path.join(TICKET_DIR, tf), "utf8"));
  totalTickets += batch.length;
  if (!existsSync(packPath)) { missingBatches.push(base); hardErr++; continue; }
  let pack;
  try { pack = JSON.parse(readFileSync(packPath, "utf8")); }
  catch (e) { problems.push(`${base}: INVALID JSON (${e.message})`); hardErr++; continue; }
  const words = pack.words || {};
  for (const t of batch) {
    const w = words[t.id];
    if (!w) { problems.push(`${base}: missing id ${t.id} (${t.word})`); hardErr++; continue; }
    totalAuthored++;
    for (const f of t.missing) {
      if (f === "vi_meaning") continue;
      if (ARRAY_FIELDS.has(f)) {
        if (!Array.isArray(w[f])) problems.push(`${base}: ${t.word}: ${f} not array`);
        // empty arrays tolerated (genuinely no synonyms) — not a hard error
      } else if (!nz(w[f])) {
        problems.push(`${base}: ${t.word}: ${f} empty/absent`); hardErr++;
      } else if (f === "difficulty" && !IELTS_BANDS.has(String(w[f]).trim())) {
        problems.push(`${base}: ${t.word}: bad difficulty '${w[f]}'`); hardErr++;
      } else if (f === "ipa" && !/[\/\[]/.test(String(w[f]))) {
        problems.push(`${base}: ${t.word}: ipa missing slashes '${w[f]}'`);
      }
    }
  }
}

console.log(`Ticket batches: ${tickets.length}, tickets: ${totalTickets}, authored: ${totalAuthored}`);
if (missingBatches.length) console.log(`MISSING PACKS (${missingBatches.length}): ${missingBatches.join(", ")}`);
if (problems.length) {
  console.log(`\nProblems (${problems.length}):`);
  for (const p of problems.slice(0, 60)) console.log("  " + p);
  if (problems.length > 60) console.log(`  ... and ${problems.length - 60} more`);
}
console.log(hardErr ? `\nHARD ERRORS: ${hardErr}` : `\nAll packs valid & complete.`);
process.exit(hardErr ? 1 : 0);
