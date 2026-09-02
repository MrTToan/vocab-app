#!/usr/bin/env node
// Store processed writing prompt(s) into writing_prompts. Used by the
// /ingest-writing-prompts skill after it extracts prompt text, (Task 1) the chart
// image, and the chart_data read once with vision.
//
// Usage: node scripts/add-writing-prompt.mjs <prompt.json | prompts.json>
// The JSON is one prompt object or an array of them:
//   { id?, task_type: "task1"|"task2", title, prompt_text,
//     image_file?, image_path?, chart_data?, model_answer?, source_file?, tags? }
// The Task 1 chart is stored INLINE in the DB (durable), never as a /public
// file: pass `image_file` (a path relative to the JSON, or absolute) — or an
// `image_path` that is a local file / data: URL — and it's embedded as a data
// URL. See resolveImage() and docs/WRITING-SPEC.md §4 for why /public is unsafe.
// Idempotent when `id` is provided (INSERT OR REPLACE preserves last_shown).
import { createClient } from "@libsql/client";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

// Extension → MIME for chart images. Mirrors IMAGE_MIME_BY_EXT in
// lib/writing/image.ts (this .mjs script can't import the TS module).
const IMAGE_MIME_BY_EXT = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  webp: "image/webp", svg: "image/svg+xml",
};

/** Read a local image file into a durable `data:<mime>;base64,…` URL, or null. */
function fileToDataUrl(filePath) {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const mime = IMAGE_MIME_BY_EXT[ext];
  if (!mime) return null;
  return `data:${mime};base64,${readFileSync(filePath).toString("base64")}`;
}

/**
 * Resolve a prompt's chart image to the DURABLE value stored in image_path.
 * Chart bytes live INLINE in the DB (the persistent .data volume), never as a
 * /public file — runtime-written public/ is baked from the repo at build time
 * and wiped on every redeploy, orphaning the row's path (broken <img>).
 *   - `image` / `image_path` already a data: URL  -> kept as-is
 *   - `image_file` or an `image_path` that points at an existing local file
 *     -> embedded inline as a data URL
 *   - a bare "/public" path with no local file (e.g. a committed sample)
 *     -> kept as-is (committed files ARE durable)
 */
function resolveImage(p, baseDir) {
  const inline = p.image ?? p.image_path;
  if (typeof inline === "string" && inline.startsWith("data:")) return inline;

  const fileRef = p.image_file ?? (typeof p.image_path === "string" && !p.image_path.startsWith("/") ? p.image_path : null);
  const candidate = fileRef ? path.resolve(baseDir, fileRef) : null;
  if (candidate && existsSync(candidate)) {
    const dataUrl = fileToDataUrl(candidate);
    if (!dataUrl) throw new Error(`Unsupported image type for ${candidate} (png/jpeg/webp/svg only)`);
    return dataUrl;
  }
  // Nothing local to embed: keep whatever image_path was given (e.g. a
  // committed /public sample), or null.
  return p.image_path ?? null;
}

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/add-writing-prompt.mjs <prompt.json>");
  process.exit(1);
}

const url = process.env.DATABASE_URL || `file:${path.join(process.cwd(), ".data", "lexi.db")}`;
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });

// Ingested prompts are the owner-curated PUBLIC bank: owner_id `__system__`,
// visibility `public` (see lib/writing/store.ts). `user_id` is legacy "who
// ingested it" metadata. Override via env if ever ingesting for another user.
const OWNER_ID = process.env.SEED_USER_ID || "local-user";
const SYSTEM_OWNER = "__system__";

async function main() {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS writing_prompts (
      id TEXT PRIMARY KEY, task_type TEXT, title TEXT, prompt_text TEXT,
      image_path TEXT, chart_data TEXT, model_answer TEXT, source_file TEXT,
      tags TEXT, last_shown INTEGER DEFAULT 0, created_at INTEGER, user_id TEXT
    )`,
  );
  try { await db.execute("ALTER TABLE writing_prompts ADD COLUMN user_id TEXT"); } catch {}
  try { await db.execute("ALTER TABLE writing_prompts ADD COLUMN owner_id TEXT"); } catch {}
  try { await db.execute("ALTER TABLE writing_prompts ADD COLUMN visibility TEXT DEFAULT 'private'"); } catch {}

  const jsonPath = path.resolve(file);
  const baseDir = path.dirname(jsonPath);
  const raw = JSON.parse(readFileSync(jsonPath, "utf8"));
  const prompts = Array.isArray(raw) ? raw : [raw];
  const now = Date.now();
  let n = 0;
  for (const p of prompts) {
    if (!p.task_type || !p.prompt_text) {
      console.error("Skipping prompt missing task_type/prompt_text:", p.title ?? "(untitled)");
      continue;
    }
    const id = p.id ?? randomUUID();
    const image_path = resolveImage(p, baseDir);
    await db.execute({
      sql: `INSERT OR REPLACE INTO writing_prompts
        (id, task_type, title, prompt_text, image_path, chart_data, model_answer, source_file, tags, last_shown, created_at, user_id, owner_id, visibility)
        VALUES (?,?,?,?,?,?,?,?,?,COALESCE((SELECT last_shown FROM writing_prompts WHERE id=?),0),?,?,?,?)`,
      args: [
        id, p.task_type, p.title ?? "", p.prompt_text,
        image_path,
        p.chart_data ? JSON.stringify(p.chart_data) : null,
        p.model_answer ?? null, p.source_file ?? null,
        JSON.stringify(p.tags ?? []), id, now, OWNER_ID, SYSTEM_OWNER, "public",
      ],
    });
    n++;
  }
  console.log(`Stored ${n} prompt(s).`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
