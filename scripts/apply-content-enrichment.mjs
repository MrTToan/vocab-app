#!/usr/bin/env node
/*
 * Apply Claude-authored CONTENT enrichment to existing PUBLIC (__system__) catalog words.
 *
 * Reads every pack under content/enrichment/*.json. Each pack is:
 *   { "meta": {...}, "words": { "<word_id>": { <field>: <value>, ... }, ... } }
 * where <field> is any of the CONTENT fields below. Values are authored by Claude
 * (NEVER an external LLM / never the app LLM chain).
 *
 * STANDALONE raw-libSQL script (createClient directly, NOT the app store), modeled on
 * scripts/ingest-vocab-packs.mjs. Safe to re-run against prod (firstmate owns that migration).
 *
 * BLANK-SAFE + ADDITIVE + IDEMPOTENT:
 *  - UPDATE only (never INSERT): a word id absent from the DB is skipped, so this can never
 *    create rows or touch the ~11 user-owned words.
 *  - Only rows with owner_id='__system__' are ever written (WHERE guard).
 *  - Each field is filled ONLY when the existing value is blank ('' / NULL, and '[]' for the
 *    JSON-array fields synonyms/collocations) — an already-populated field is NEVER overwritten.
 *  - EXCEPTION: vi_meaning is overwritten ONLY when the pack carries an explicit
 *    `vi_meaning_correction` (a subagent flagged the existing value as clearly wrong).
 *
 * Target DB = $DATABASE_URL, else file:.data/lexi.db.
 * ALWAYS develop/verify against a COPY first — NEVER the real or production DB:
 *   DATABASE_URL=file:/tmp/lexi-copy.db node scripts/apply-content-enrichment.mjs
 */
import { createClient } from "@libsql/client";
import { readFileSync, readdirSync, existsSync } from "fs";
import path from "path";

const SYSTEM_OWNER = "__system__"; // must match SYSTEM_OWNER in lib/auth/user.ts
const url = process.env.DATABASE_URL || `file:${path.resolve(".data/lexi.db")}`;
const authToken = process.env.DATABASE_AUTH_TOKEN;

const ROOT = process.cwd();
const PACK_DIR = process.env.PACK_DIR || path.join(ROOT, "content", "enrichment");

// Plain-text content fields, filled only when blank. `difficulty` is written by raw SQL.
const TEXT_FIELDS = ["part_of_speech", "ipa", "definition_en", "example_simple", "example_complex", "difficulty"];
// JSON-array fields, stored as JSON text; '[]' counts as blank.
const ARRAY_FIELDS = ["synonyms", "collocations"];
const IELTS_BANDS = new Set(["5.0", "6.0", "7.0", "8.0", "9.0"]);

const norm = (v) => (v == null ? "" : String(v).trim());

async function ensureSchema(db) {
  // GUARDEDLY ensure difficulty column exists (owned by app code; guard so this data-only
  // script works before OR after that change is present on the target).
  try { await db.execute(`ALTER TABLE words ADD COLUMN "difficulty" TEXT`); } catch { /* exists */ }
}

function loadPacks() {
  if (!existsSync(PACK_DIR)) throw new Error(`pack dir not found: ${PACK_DIR}`);
  const files = readdirSync(PACK_DIR).filter((f) => f.endsWith(".json")).sort();
  const merged = new Map(); // id -> fields (later packs win per-field; shouldn't overlap)
  for (const f of files) {
    const data = JSON.parse(readFileSync(path.join(PACK_DIR, f), "utf8"));
    const words = data.words || {};
    for (const [id, fields] of Object.entries(words)) {
      const cur = merged.get(id) || {};
      merged.set(id, { ...cur, ...fields });
    }
  }
  return { files, merged };
}

/** Build a single blank-safe UPDATE for one word id. Returns null if nothing to write. */
function buildUpdate(id, fields) {
  const sets = [];
  const args = [];

  for (const col of TEXT_FIELDS) {
    let v = norm(fields[col]);
    if (!v) continue;
    if (col === "difficulty" && !IELTS_BANDS.has(v)) continue; // ignore malformed band
    // fill only when existing is blank
    sets.push(`"${col}" = CASE WHEN "${col}" IS NULL OR TRIM("${col}") = '' THEN ? ELSE "${col}" END`);
    args.push(v);
  }

  for (const col of ARRAY_FIELDS) {
    const arr = fields[col];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const json = JSON.stringify(arr.map((s) => String(s).trim()).filter(Boolean));
    if (json === "[]") continue;
    sets.push(`"${col}" = CASE WHEN "${col}" IS NULL OR TRIM("${col}") = '' OR TRIM("${col}") = '[]' THEN ? ELSE "${col}" END`);
    args.push(json);
  }

  // vi_meaning correction: overwrite unconditionally (a subagent flagged the old value wrong).
  const corr = norm(fields.vi_meaning_correction);
  if (corr) { sets.push(`"vi_meaning" = ?`); args.push(corr); }

  if (!sets.length) return null;
  const sql = `UPDATE words SET ${sets.join(", ")} WHERE id = ? AND owner_id = ?`;
  args.push(id, SYSTEM_OWNER);
  return { sql, args };
}

async function main() {
  console.log(`\nApply content enrichment — target: ${url}\n  packs: ${PACK_DIR}\n`);
  const db = createClient({ url, authToken });
  await ensureSchema(db);

  const { files, merged } = loadPacks();
  console.log(`Loaded ${files.length} pack file(s); ${merged.size} unique word id(s).`);

  const stmts = [];
  let corrections = 0;
  for (const [id, fields] of merged) {
    if (norm(fields.vi_meaning_correction)) corrections++;
    const u = buildUpdate(id, fields);
    if (u) stmts.push(u);
  }
  console.log(`Prepared ${stmts.length} UPDATE(s) (${corrections} vi_meaning correction(s)).`);

  let written = 0;
  for (let i = 0; i < stmts.length; i += 200) {
    const chunk = stmts.slice(i, i + 200);
    const res = await db.batch(chunk, "write");
    for (const r of res) written += Number(r.rowsAffected || 0);
  }
  console.log(`Applied — ${written} row(s) affected (ids not present in target are skipped).`);
  process.exit(0);
}

main().catch((e) => {
  console.error("apply failed:", e);
  process.exit(1);
});
