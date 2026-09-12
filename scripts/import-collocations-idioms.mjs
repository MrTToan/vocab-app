#!/usr/bin/env node
/*
 * Import the "Collocations & Idioms" vocabulary pack as PUBLIC (SYSTEM-owned)
 * shared content linked into one public collection.
 *
 * IDEMPOTENT and ADDITIVE — safe to re-run: deterministic word ids + a
 * blank-safe upsert, so re-running never duplicates and never wipes richer
 * content already present for a word.
 *
 * Data pack: content/collections/collocations-idioms.json
 *   { collection:{name,emoji,description}, meta:{...}, words:[ {word, vi_meaning,
 *     part_of_speech, ipa, definition_en, synonyms[], collocations[],
 *     example_simple, example_complex, false_friend_note, difficulty}, ... ] }
 * A fully-enriched word carries all fields; a seed-only word carries just
 * word + vi_meaning and leaves the rest blank/[]/null for a later batch.
 *
 * Word id scheme MATCHES scripts/ingest-public-collections.mjs:
 *   id = 'pubcol-w-' + sha1(word.trim().toLowerCase()).slice(0,16)
 * and an existing __system__ word with the same normalized text is REUSED
 * (its id kept) so the same term across sources is ONE catalog row linked to
 * many collections — never a duplicate.
 *
 * Target DB = $DATABASE_URL, else file:.data/lexi.db.
 * ALWAYS run against a COPY first — NEVER the real or production DB:
 *   cp .data/lexi.db /tmp/copy.db
 *   DATABASE_URL=file:/tmp/copy.db node scripts/import-collocations-idioms.mjs
 */
import { createClient } from "@libsql/client";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";

const SYSTEM_OWNER = "__system__"; // must match SYSTEM_OWNER in lib/auth/user.ts
const url = process.env.DATABASE_URL || `file:${path.resolve(".data/lexi.db")}`;
const authToken = process.env.DATABASE_AUTH_TOKEN;

const ROOT = process.cwd();
const PACK = path.join(ROOT, "content", "collections", "collocations-idioms.json");
const COLLECTION_ID = "pubcol-col-collocations-idioms"; // neutral, deterministic
const TAGS = ["collocation", "idiom"];
const IELTS_BANDS = new Set(["5.0", "6.0", "7.0", "8.0", "9.0"]);

const norm = (s) => String(s ?? "").trim().toLowerCase();
const sha = (s) => createHash("sha1").update(s).digest("hex").slice(0, 16);
const newWordId = (word) => `pubcol-w-${sha(norm(word))}`;

// Column order for the INSERT (content + owner_id). Mirrors CONTENT_COLS in
// lib/db.ts (now including "difficulty").
const CONTENT_COLS = [
  "id", "word", "part_of_speech", "ipa", "vi_meaning", "definition_en",
  "synonyms", "collocations", "example_simple", "example_complex",
  "false_friend_note", "personal_note", "tags", "source", "difficulty", "created_at",
];

function band(v) {
  const s = String(v ?? "").trim();
  return IELTS_BANDS.has(s) ? s : "";
}

function wordArgs(w, existingId) {
  const id = existingId || newWordId(w.word);
  return {
    id,
    args: [
      id,
      String(w.word).trim(),
      w.part_of_speech || "",
      w.ipa || "",
      w.vi_meaning || "",
      w.definition_en || "",
      JSON.stringify(w.synonyms || []),
      JSON.stringify(w.collocations || []),
      w.example_simple || "",
      w.example_complex || "",
      w.false_friend_note || "",
      "", // personal_note — never authored by an import; preserved on conflict
      JSON.stringify(TAGS),
      "manual", // neutral source (Word.source union: csv|manual|paste)
      band(w.difficulty),
      Date.now(),
    ],
  };
}

// Blank-safe upsert: on conflict, keep an existing non-empty value when the
// incoming (seed) value is blank, so a seed re-import never wipes enriched
// content — and vice-versa a later enriched import fills the blanks. JSON array
// columns treat "[]" as blank too. created_at + personal_note are preserved.
function upsertSql() {
  const cols = CONTENT_COLS.map((c) => `"${c}"`).join(", ");
  const ph = CONTENT_COLS.map(() => "?").join(", ");
  const setBlankSafe = (c) =>
    `"${c}" = COALESCE(NULLIF(excluded."${c}", ''), words."${c}")`;
  const setBlankSafeJson = (c) =>
    `"${c}" = CASE WHEN excluded."${c}" IN ('', '[]') THEN words."${c}" ELSE excluded."${c}" END`;
  return `INSERT INTO words (${cols}, owner_id) VALUES (${ph}, ?)
    ON CONFLICT(id) DO UPDATE SET
      word = excluded.word,
      ${setBlankSafe("part_of_speech")},
      ${setBlankSafe("ipa")},
      ${setBlankSafe("vi_meaning")},
      ${setBlankSafe("definition_en")},
      ${setBlankSafeJson("synonyms")},
      ${setBlankSafeJson("collocations")},
      ${setBlankSafe("example_simple")},
      ${setBlankSafe("example_complex")},
      ${setBlankSafe("false_friend_note")},
      ${setBlankSafe("tags")},
      source = excluded.source,
      ${setBlankSafe("difficulty")},
      owner_id = excluded.owner_id`;
}

async function ensureSchema(db) {
  const contentCols = CONTENT_COLS.map((h) => `"${h}" TEXT`).join(", ");
  await db.execute(`CREATE TABLE IF NOT EXISTS words (${contentCols}, owner_id TEXT, PRIMARY KEY ("id"))`);
  await db.execute(`CREATE TABLE IF NOT EXISTS collections (id TEXT PRIMARY KEY, name TEXT, description TEXT, emoji TEXT, created_at INTEGER, owner_id TEXT, visibility TEXT DEFAULT 'private')`);
  await db.execute(`CREATE TABLE IF NOT EXISTS word_collections (word_id TEXT, collection_id TEXT, PRIMARY KEY (word_id, collection_id))`);
  // Tolerate a DB that predates these columns (guarded, idempotent).
  for (const [t, c] of [
    ["words", "owner_id TEXT"],
    ['words', '"difficulty" TEXT'],
    ["collections", "owner_id TEXT"],
    ["collections", "visibility TEXT DEFAULT 'private'"],
  ]) {
    try { await db.execute(`ALTER TABLE ${t} ADD COLUMN ${c}`); } catch { /* exists */ }
  }
}

async function systemWordIndex(db) {
  const rs = await db.execute({ sql: "SELECT id, word FROM words WHERE owner_id = ?", args: [SYSTEM_OWNER] });
  const m = new Map();
  for (const r of rs.rows) {
    const k = norm(r.word);
    if (k && !m.has(k)) m.set(k, String(r.id));
  }
  return m;
}

async function main() {
  console.log(`\nImport Collocations & Idioms — target: ${url}\n`);
  const data = JSON.parse(readFileSync(PACK, "utf8"));
  const meta = data.collection;
  const db = createClient({ url, authToken });
  await ensureSchema(db);

  // 1) upsert the public collection (SYSTEM-owned, visibility=public)
  await db.execute({
    sql: `INSERT INTO collections (id, name, description, emoji, created_at, owner_id, visibility)
          VALUES (?,?,?,?,?,?, 'public')
          ON CONFLICT(id) DO UPDATE SET
            name=excluded.name, description=excluded.description, emoji=excluded.emoji,
            owner_id=excluded.owner_id, visibility='public'`,
    args: [COLLECTION_ID, meta.name, meta.description || "", meta.emoji || "", Date.now(), SYSTEM_OWNER],
  });

  // 2) upsert words (blank-safe, deterministic id, reuse existing system id) + link
  const sysIndex = await systemWordIndex(db);
  const upsert = upsertSql();
  const wordStmts = [];
  const linkStmts = [];
  const seenInRun = new Set();
  let enriched = 0;
  for (const w of data.words) {
    if (!w.word || !String(w.word).trim()) continue;
    const key = norm(w.word);
    if (seenInRun.has(key)) continue; // pack-internal dedup by normalized text
    seenInRun.add(key);
    const existingId = sysIndex.get(key);
    const { id, args } = wordArgs(w, existingId);
    sysIndex.set(key, id);
    wordStmts.push({ sql: upsert, args: [...args, SYSTEM_OWNER] });
    linkStmts.push({
      sql: "INSERT OR IGNORE INTO word_collections (word_id, collection_id) VALUES (?,?)",
      args: [id, COLLECTION_ID],
    });
    if (band(w.difficulty)) enriched++;
  }
  for (let i = 0; i < wordStmts.length; i += 400)
    await db.batch(wordStmts.slice(i, i + 400), "write");
  for (let i = 0; i < linkStmts.length; i += 400)
    await db.batch(linkStmts.slice(i, i + 400), "write");

  // 3) verify
  const cnt = await db.execute({
    sql: `SELECT COUNT(*) n FROM word_collections WHERE collection_id = ?`,
    args: [COLLECTION_ID],
  });
  const col = await db.execute({
    sql: `SELECT name, owner_id, visibility FROM collections WHERE id = ?`,
    args: [COLLECTION_ID],
  });
  const withBand = await db.execute({
    sql: `SELECT COUNT(*) n FROM words w JOIN word_collections wc ON wc.word_id = w.id
          WHERE wc.collection_id = ? AND w.difficulty IN ('5.0','6.0','7.0','8.0','9.0')`,
    args: [COLLECTION_ID],
  });
  const c = col.rows[0];
  console.log(`Collection: "${c?.name}" [${c?.owner_id}/${c?.visibility}]`);
  console.log(`Words in pack: ${data.words.length} · linked: ${cnt.rows[0]?.n} · with IELTS band: ${withBand.rows[0]?.n} (pack enriched: ${enriched})`);
  const ok = String(c?.owner_id) === SYSTEM_OWNER && String(c?.visibility) === "public";
  console.log(ok ? "\n✅ import complete.\n" : "\n⚠️  collection is not public/SYSTEM-owned.\n");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("import failed:", e);
  process.exit(1);
});
