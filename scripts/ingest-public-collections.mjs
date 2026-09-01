#!/usr/bin/env node
/*
 * Ingest the curated public vocabulary packs as PUBLIC (SYSTEM-owned) collections.
 * IDEMPOTENT — safe to re-run: deterministic ids + upserts, never duplicates.
 *
 * Requires the content/progress-split schema (owner_id, visibility, SYSTEM-owned
 * public collections). Run the foundation migration FIRST on any pre-split DB:
 *   scripts/migrate-content-split.mjs
 *
 * For each pack (content/collections/<pack>.json):
 *   - upserts every pack word as owner_id=__system__ shared content
 *     (maps the pack fields onto the Word shape; ipa is left BLANK by design);
 *   - upserts the public collection (visibility=public, SYSTEM-owned) with its
 *     name/emoji/description;
 *   - links the words to that collection;
 *   - replaces each word's question bank from content/collections/questions/*.out.json
 *     (10 cloze + 10 translate + 10 scenario per word).
 * Also promotes the existing "IELTS Task 1" collection to public/SYSTEM.
 *
 * Target DB = $DATABASE_URL, else file:.data/lexi.db.
 * ALWAYS develop/verify against a COPY first — NEVER the real DB:
 *   DATABASE_URL=file:/path/to/copy.db node scripts/ingest-public-collections.mjs
 */
import { createClient } from "@libsql/client";
import { createHash } from "crypto";
import { readFileSync, readdirSync } from "fs";
import path from "path";

const SYSTEM_OWNER = "__system__"; // must match SYSTEM_OWNER in lib/auth/user.ts
const url = process.env.DATABASE_URL || `file:${path.resolve(".data/lexi.db")}`;
const authToken = process.env.DATABASE_AUTH_TOKEN;

const ROOT = process.cwd();
const COLL_DIR = path.join(ROOT, "content", "collections");
const Q_DIR = path.join(COLL_DIR, "questions");

// The three packs to ingest (file under content/collections/). The public IELTS
// Task 1 promotion (step 3) is handled separately below by collection name.
const PACKS = [
  { file: "ielts-task2.json", key: "ielts-task2" },
  { file: "casual-100.json", key: "casual-100" },
  { file: "academic-100.json", key: "academic-100" },
];
const PROMOTE_BY_NAME = ["IELTS Task 1"]; // pre-existing owner collection -> public/SYSTEM

const norm = (s) => String(s ?? "").trim().toLowerCase();
const sha = (s) => createHash("sha1").update(s).digest("hex").slice(0, 16);
const collectionId = (key) => `pubcol-col-${key}`;
const questionId = (wordId, type, i) => `pubcol-q-${sha(wordId)}-${type}-${i}`;

// Deterministic id for a NEW system word (reused rows keep their existing id).
const newWordId = (word) => `pubcol-w-${sha(norm(word))}`;

const WORD_COLS = [
  "id", "word", "part_of_speech", "ipa", "vi_meaning", "definition_en",
  "synonyms", "collocations", "example_simple", "example_complex",
  "false_friend_note", "personal_note", "tags", "source", "created_at", "owner_id",
];

function loadQuestionBanks() {
  // Merge every *.out.json into one map keyed by the EXACT word text (verbatim).
  const bank = new Map();
  for (const f of readdirSync(Q_DIR).filter((f) => f.endsWith(".out.json"))) {
    const obj = JSON.parse(readFileSync(path.join(Q_DIR, f), "utf8"));
    for (const [word, v] of Object.entries(obj)) bank.set(word, v);
  }
  return bank;
}

/** Flatten a word's bank object into deterministic Question rows for word_id. */
function bankToRows(wordId, v) {
  const rows = [];
  let i = 0;
  for (const c of v?.cloze || []) {
    if (c && c.sentence)
      rows.push({ id: questionId(wordId, "cloze", i++), word_id: wordId, type: "cloze", direction: "", payload: c.sentence, answer: c.answer || "" });
  }
  i = 0;
  for (const t of v?.translate || []) {
    if (t && t.source)
      rows.push({ id: questionId(wordId, "translate", i++), word_id: wordId, type: "translate", direction: t.direction === "vn_to_en" ? "vn_to_en" : "en_to_vn", payload: t.source, answer: "" });
  }
  i = 0;
  for (const s of v?.scenario || []) {
    const prompt = typeof s === "string" ? s : s?.prompt || "";
    if (prompt)
      rows.push({ id: questionId(wordId, "scenario", i++), word_id: wordId, type: "scenario", direction: "", payload: prompt, answer: "" });
  }
  return rows;
}

function wordUpsertStmt(w, existingId) {
  const id = existingId || newWordId(w.word);
  const created_at = Date.now();
  const args = [
    id,
    String(w.word).trim(),
    w.part_of_speech || "",
    "", // ipa — intentionally BLANK
    w.vi_meaning || "",
    w.definition_en || "",
    JSON.stringify(w.synonyms || []),
    JSON.stringify(w.collocations || []),
    w.example_simple || "",
    w.example_complex || "",
    w.false_friend_note || "",
    "", // personal_note (never clobbered on update; see ON CONFLICT below)
    JSON.stringify([w._packKey, w.category].filter(Boolean)),
    "manual",
    created_at,
    SYSTEM_OWNER,
  ];
  // Upsert by id: refresh CONTENT + owner on conflict, but preserve created_at
  // and personal_note (an existing SYSTEM catalog word may carry a real note).
  const sql = `INSERT INTO words (${WORD_COLS.map((c) => `"${c}"`).join(", ")})
    VALUES (${WORD_COLS.map(() => "?").join(", ")})
    ON CONFLICT(id) DO UPDATE SET
      word=excluded.word, part_of_speech=excluded.part_of_speech, ipa=excluded.ipa,
      vi_meaning=excluded.vi_meaning, definition_en=excluded.definition_en,
      synonyms=excluded.synonyms, collocations=excluded.collocations,
      example_simple=excluded.example_simple, example_complex=excluded.example_complex,
      false_friend_note=excluded.false_friend_note, tags=excluded.tags,
      source=excluded.source, owner_id=excluded.owner_id`;
  return { stmt: { sql, args }, id };
}

async function ensureSchema(db) {
  const contentCols = [
    "id", "word", "part_of_speech", "ipa", "vi_meaning", "definition_en",
    "synonyms", "collocations", "example_simple", "example_complex",
    "false_friend_note", "personal_note", "tags", "source", "created_at",
  ].map((h) => `"${h}" TEXT`).join(", ");
  await db.execute(`CREATE TABLE IF NOT EXISTS words (${contentCols}, owner_id TEXT, PRIMARY KEY ("id"))`);
  await db.execute(`CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, word_id TEXT, type TEXT, direction TEXT, payload TEXT, answer TEXT)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS collections (id TEXT PRIMARY KEY, name TEXT, description TEXT, emoji TEXT, created_at INTEGER, owner_id TEXT, visibility TEXT DEFAULT 'private')`);
  await db.execute(`CREATE TABLE IF NOT EXISTS word_collections (word_id TEXT, collection_id TEXT, PRIMARY KEY (word_id, collection_id))`);
  // Tolerate a pre-split words/collections table that predates owner_id/visibility.
  for (const [t, c] of [["words", "owner_id TEXT"], ["collections", "owner_id TEXT"], ["collections", "visibility TEXT DEFAULT 'private'"]]) {
    try { await db.execute(`ALTER TABLE ${t} ADD COLUMN ${c}`); } catch { /* exists */ }
  }
}

async function systemWordIndex(db) {
  // normalized text -> id for existing SYSTEM words, so we reuse (upsert) an
  // existing catalog word instead of creating a duplicate. Never touches a
  // user's personal (non-system) word of the same text.
  const rs = await db.execute({ sql: "SELECT id, word FROM words WHERE owner_id = ?", args: [SYSTEM_OWNER] });
  const m = new Map();
  for (const r of rs.rows) {
    const k = norm(r.word);
    if (k && !m.has(k)) m.set(k, String(r.id));
  }
  return m;
}

async function main() {
  console.log(`\nIngest public collections — target: ${url}\n`);
  const db = createClient({ url, authToken });
  await ensureSchema(db);

  const banks = loadQuestionBanks();
  const sysIndex = await systemWordIndex(db);
  const report = [];

  for (const pack of PACKS) {
    const data = JSON.parse(readFileSync(path.join(COLL_DIR, pack.file), "utf8"));
    const meta = data.collection;
    const cid = collectionId(pack.key);

    // 1) upsert the public collection (SYSTEM-owned, visibility=public)
    await db.execute({
      sql: `INSERT INTO collections (id, name, description, emoji, created_at, owner_id, visibility)
            VALUES (?,?,?,?,?,?, 'public')
            ON CONFLICT(id) DO UPDATE SET
              name=excluded.name, description=excluded.description, emoji=excluded.emoji,
              owner_id=excluded.owner_id, visibility='public'`,
      args: [cid, meta.name, meta.description || "", meta.emoji || "", Date.now(), SYSTEM_OWNER],
    });

    // 2) upsert words, link to collection, replace banks
    const wordStmts = [];
    const linkStmts = [];
    const qStmts = [];
    let qTotal = 0;
    for (const w of data.words) {
      w._packKey = pack.key;
      const existingId = sysIndex.get(norm(w.word));
      const { stmt, id } = wordUpsertStmt(w, existingId);
      sysIndex.set(norm(w.word), id); // so a repeated word in-run reuses the id
      wordStmts.push(stmt);
      linkStmts.push({
        sql: "INSERT OR IGNORE INTO word_collections (word_id, collection_id) VALUES (?,?)",
        args: [id, cid],
      });
      // replace this word's bank cleanly (delete then insert = exactly-N, idempotent)
      qStmts.push({ sql: "DELETE FROM questions WHERE word_id = ?", args: [id] });
      const rows = bankToRows(id, banks.get(w.word));
      qTotal += rows.length;
      for (const r of rows)
        qStmts.push({
          sql: "INSERT OR REPLACE INTO questions (id, word_id, type, direction, payload, answer) VALUES (?,?,?,?,?,?)",
          args: [r.id, r.word_id, r.type, r.direction, r.payload, r.answer],
        });
    }
    await db.batch(wordStmts, "write");
    await db.batch(linkStmts, "write");
    // questions in chunks to keep statement batches reasonable
    for (let i = 0; i < qStmts.length; i += 400)
      await db.batch(qStmts.slice(i, i + 400), "write");

    report.push({ pack: meta.name, words: data.words.length, questions: qTotal, collection: cid });
  }

  // 3) promote pre-existing collections (e.g. IELTS Task 1) to public/SYSTEM
  for (const name of PROMOTE_BY_NAME) {
    const r = await db.execute({
      sql: "UPDATE collections SET visibility='public', owner_id=? WHERE name=?",
      args: [SYSTEM_OWNER, name],
    });
    report.push({ promoted: name, rows: r.rowsAffected ?? 0 });
  }

  console.log("Result:");
  for (const r of report) console.log("  " + JSON.stringify(r));

  // ── verification ──────────────────────────────────────────────────────
  const pub = await db.execute(
    `SELECT c.id, c.name, c.owner_id, c.visibility, COUNT(wc.word_id) AS words
       FROM collections c LEFT JOIN word_collections wc ON wc.collection_id = c.id
      WHERE c.visibility = 'public' GROUP BY c.id ORDER BY c.name`,
  );
  console.log("\nPublic collections now visible:");
  let bad = 0;
  for (const r of pub.rows) {
    const ownerOk = String(r.owner_id) === SYSTEM_OWNER;
    if (!ownerOk) bad++;
    console.log(`  ${ownerOk ? "✅" : "⚠️ "} ${r.name}  [${r.owner_id}/${r.visibility}]  words=${r.words}`);
  }
  // sanity: our pack words each have a 30-question bank
  const q = await db.execute(
    `SELECT COUNT(*) n FROM questions WHERE word_id LIKE 'pubcol-w-%' OR word_id IN
       (SELECT word_id FROM word_collections WHERE collection_id LIKE 'pubcol-col-%')`,
  );
  console.log(`\n  pack questions total: ${q.rows[0]?.n}`);
  const ok = bad === 0;
  console.log(ok ? "\n✅ ingest complete.\n" : "\n⚠️  a public collection is not SYSTEM-owned.\n");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("ingest failed:", e);
  process.exit(1);
});
