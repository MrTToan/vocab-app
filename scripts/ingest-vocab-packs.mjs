#!/usr/bin/env node
/*
 * Ingest two curated vocabulary packs as PUBLIC (SYSTEM-owned) collections:
 *   - content/collections/common-english-vocabulary.json  → "Common English Vocabulary"
 *   - content/collections/ielts-vocabulary-by-band.json    → "IELTS Vocabulary by Band"
 *
 * Both packs carry a per-word `difficulty` (an IELTS target band string, one of
 * 5.0/6.0/7.0/8.0/9.0) derived from each pack's own CEFR/IELTS bands.
 *
 * STANDALONE raw-libSQL script (uses createClient directly, NOT the app store), so it
 * works whether or not the parallel `difficulty` app-code change has merged: it GUARDEDLY
 * ensures the `words.difficulty` column exists before writing (ALTER TABLE … in a try/catch)
 * and writes difficulty via raw SQL, never through the app CONTENT_COLS insert path.
 *
 * IDEMPOTENT + deterministic: catalog-word ids follow the same scheme as
 * scripts/ingest-public-collections.mjs — id = 'pubcol-w-' + sha1(word.trim().toLowerCase())
 * .slice(0,16) — and an existing __system__ word of the same lemma is REUSED (never
 * duplicated), so a word shared across packs becomes ONE catalog row linked to many
 * collections (word_collections OR IGNORE). Re-runs upsert in place.
 *
 * BLANK-SAFE upsert: on conflict a seed/empty value never overwrites an already-populated
 * field (COALESCE(NULLIF(excluded.col,''), words.col)); empty JSON arrays ('[]') count as
 * blank too. So a seed-only re-import can never wipe richer enriched content, and vice-versa.
 * created_at and personal_note are preserved on conflict.
 *
 * Target DB = $DATABASE_URL, else file:.data/lexi.db.
 * ALWAYS develop/verify against a COPY first — NEVER the real or production DB:
 *   DATABASE_URL=file:/tmp/lexi-copy.db node scripts/ingest-vocab-packs.mjs
 */
import { createClient } from "@libsql/client";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";

const SYSTEM_OWNER = "__system__"; // must match SYSTEM_OWNER in lib/auth/user.ts
const url = process.env.DATABASE_URL || `file:${path.resolve(".data/lexi.db")}`;
const authToken = process.env.DATABASE_AUTH_TOKEN;

const ROOT = process.cwd();
const COLL_DIR = path.join(ROOT, "content", "collections");

// The two packs to ingest (file under content/collections/, deterministic collection key).
const PACKS = [
  { file: "common-english-vocabulary.json", key: "common-english-vocab" },
  { file: "ielts-vocabulary-by-band.json", key: "ielts-vocab-band" },
];

const norm = (s) => String(s ?? "").trim().toLowerCase();
const sha = (s) => createHash("sha1").update(s).digest("hex").slice(0, 16);
const collectionId = (key) => `pubcol-col-${key}`;
// Same deterministic catalog-word id scheme as scripts/ingest-public-collections.mjs.
const newWordId = (word) => `pubcol-w-${sha(norm(word))}`;

// Content columns written by this script. `difficulty` is appended and written by raw SQL
// (guarded ALTER below) so this script does not depend on the parallel app-code change.
const WORD_COLS = [
  "id", "word", "part_of_speech", "ipa", "vi_meaning", "definition_en",
  "synonyms", "collocations", "example_simple", "example_complex",
  "false_friend_note", "personal_note", "tags", "source", "created_at", "owner_id",
  "difficulty",
];

async function ensureSchema(db) {
  const contentCols = [
    "id", "word", "part_of_speech", "ipa", "vi_meaning", "definition_en",
    "synonyms", "collocations", "example_simple", "example_complex",
    "false_friend_note", "personal_note", "tags", "source", "created_at",
  ].map((h) => `"${h}" TEXT`).join(", ");
  await db.execute(`CREATE TABLE IF NOT EXISTS words (${contentCols}, owner_id TEXT, PRIMARY KEY ("id"))`);
  await db.execute(`CREATE TABLE IF NOT EXISTS collections (id TEXT PRIMARY KEY, name TEXT, description TEXT, emoji TEXT, created_at INTEGER, owner_id TEXT, visibility TEXT DEFAULT 'private')`);
  await db.execute(`CREATE TABLE IF NOT EXISTS word_collections (word_id TEXT, collection_id TEXT, PRIMARY KEY (word_id, collection_id))`);
  // Tolerate a pre-split words/collections table that predates owner_id/visibility …
  for (const [t, c] of [["words", "owner_id TEXT"], ["collections", "owner_id TEXT"], ["collections", "visibility TEXT DEFAULT 'private'"]]) {
    try { await db.execute(`ALTER TABLE ${t} ADD COLUMN ${c}`); } catch { /* exists */ }
  }
  // … and GUARDEDLY ensure the difficulty column exists (owned by the parallel task in app
  // code; added here so this data-only script works before OR after that change merges).
  try { await db.execute(`ALTER TABLE words ADD COLUMN "difficulty" TEXT`); } catch { /* exists */ }
}

async function systemWordIndex(db) {
  // normalized text -> id for existing SYSTEM words, so we reuse (upsert) an existing catalog
  // word instead of creating a duplicate. Never touches a user's personal (non-system) word.
  const rs = await db.execute({ sql: "SELECT id, word FROM words WHERE owner_id = ?", args: [SYSTEM_OWNER] });
  const m = new Map();
  for (const r of rs.rows) {
    const k = norm(r.word);
    if (k && !m.has(k)) m.set(k, String(r.id));
  }
  return m;
}

function wordUpsertStmt(w, existingId, collKey) {
  const id = existingId || newWordId(w.word);
  const created_at = Date.now();
  const tags = Array.isArray(w.tags) && w.tags.length ? w.tags : [collKey, w.band].filter(Boolean);
  const args = [
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
    "", // personal_note — never clobbered on update (see ON CONFLICT below)
    JSON.stringify(tags),
    w.source || "manual",
    created_at,
    SYSTEM_OWNER,
    w.difficulty || "",
  ];
  // Blank-safe upsert by id: on conflict, refresh CONTENT only where the incoming value is
  // non-blank ('' and empty JSON array '[]' both count as blank), so seed data can never wipe
  // richer enriched content already present (and vice-versa). created_at + personal_note kept.
  const nz = (col) => `COALESCE(NULLIF(NULLIF(excluded."${col}", ''), '[]'), words."${col}")`;
  const sql = `INSERT INTO words (${WORD_COLS.map((c) => `"${c}"`).join(", ")})
    VALUES (${WORD_COLS.map(() => "?").join(", ")})
    ON CONFLICT(id) DO UPDATE SET
      word=excluded.word,
      part_of_speech=${nz("part_of_speech")},
      ipa=${nz("ipa")},
      vi_meaning=${nz("vi_meaning")},
      definition_en=${nz("definition_en")},
      synonyms=${nz("synonyms")},
      collocations=${nz("collocations")},
      example_simple=${nz("example_simple")},
      example_complex=${nz("example_complex")},
      false_friend_note=${nz("false_friend_note")},
      tags=${nz("tags")},
      source=${nz("source")},
      difficulty=${nz("difficulty")},
      owner_id=excluded.owner_id`;
  return { stmt: { sql, args }, id };
}

async function main() {
  console.log(`\nIngest vocabulary packs — target: ${url}\n`);
  const db = createClient({ url, authToken });
  await ensureSchema(db);

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

    // 2) upsert words + link to collection
    const wordStmts = [];
    const linkStmts = [];
    const byDiff = {};
    for (const w of data.words) {
      const existingId = sysIndex.get(norm(w.word));
      const { stmt, id } = wordUpsertStmt(w, existingId, pack.key);
      sysIndex.set(norm(w.word), id); // a repeated lemma in-run reuses the id
      wordStmts.push(stmt);
      linkStmts.push({
        sql: "INSERT OR IGNORE INTO word_collections (word_id, collection_id) VALUES (?,?)",
        args: [id, cid],
      });
      byDiff[w.difficulty || "(none)"] = (byDiff[w.difficulty || "(none)"] || 0) + 1;
    }
    for (let i = 0; i < wordStmts.length; i += 400) await db.batch(wordStmts.slice(i, i + 400), "write");
    for (let i = 0; i < linkStmts.length; i += 400) await db.batch(linkStmts.slice(i, i + 400), "write");

    report.push({ pack: meta.name, words: data.words.length, collection: cid, byDifficulty: byDiff });
  }

  console.log("Result:");
  for (const r of report) console.log("  " + JSON.stringify(r));

  // ── verification ──────────────────────────────────────────────────────
  const pub = await db.execute(
    `SELECT c.id, c.name, c.owner_id, c.visibility, COUNT(wc.word_id) AS words
       FROM collections c LEFT JOIN word_collections wc ON wc.collection_id = c.id
      WHERE c.id IN ('pubcol-col-common-english-vocab','pubcol-col-ielts-vocab-band')
      GROUP BY c.id ORDER BY c.name`,
  );
  console.log("\nCollections now visible:");
  let bad = 0;
  for (const r of pub.rows) {
    const ownerOk = String(r.owner_id) === SYSTEM_OWNER && String(r.visibility) === "public";
    if (!ownerOk) bad++;
    console.log(`  ${ownerOk ? "✅" : "⚠️ "} ${r.name}  [${r.owner_id}/${r.visibility}]  words=${r.words}`);
  }
  // difficulty populated for every ingested word
  const diff = await db.execute(
    `SELECT difficulty, COUNT(*) n FROM words
      WHERE id IN (SELECT word_id FROM word_collections WHERE collection_id IN
        ('pubcol-col-common-english-vocab','pubcol-col-ielts-vocab-band'))
      GROUP BY difficulty ORDER BY difficulty`,
  );
  console.log("\nDifficulty distribution across ingested words:");
  let missing = 0;
  for (const r of diff.rows) {
    if (!r.difficulty) missing += Number(r.n);
    console.log(`  band ${r.difficulty || "(EMPTY)"}: ${r.n}`);
  }
  const ok = bad === 0 && missing === 0;
  console.log(ok
    ? "\n✅ ingest complete — both collections public/SYSTEM, difficulty populated on every word.\n"
    : `\n⚠️  problem: ${bad} bad collection(s), ${missing} word(s) missing difficulty.\n`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("ingest failed:", e);
  process.exit(1);
});
