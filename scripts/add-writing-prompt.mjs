#!/usr/bin/env node
// Store processed writing prompt(s) into writing_prompts. Used by the
// /ingest-writing-prompts skill after it extracts prompt text, (Task 1) the chart
// image, and the chart_data read once with vision.
//
// Usage: node scripts/add-writing-prompt.mjs <prompt.json | prompts.json>
// The JSON is one prompt object or an array of them:
//   { id?, task_type: "task1"|"task2", title, prompt_text,
//     image_path?, chart_data?, model_answer?, source_file?, tags? }
// Idempotent when `id` is provided (INSERT OR REPLACE preserves last_shown).
import { createClient } from "@libsql/client";
import { readFileSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/add-writing-prompt.mjs <prompt.json>");
  process.exit(1);
}

const url = process.env.DATABASE_URL || `file:${path.join(process.cwd(), ".data", "lexi.db")}`;
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });

// Prompts belong to the owner account (multi-tenancy). Override via env if ever
// ingesting for another user.
const OWNER_ID = process.env.SEED_USER_ID || "local-user";

async function main() {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS writing_prompts (
      id TEXT PRIMARY KEY, task_type TEXT, title TEXT, prompt_text TEXT,
      image_path TEXT, chart_data TEXT, model_answer TEXT, source_file TEXT,
      tags TEXT, last_shown INTEGER DEFAULT 0, created_at INTEGER, user_id TEXT
    )`,
  );
  try { await db.execute("ALTER TABLE writing_prompts ADD COLUMN user_id TEXT"); } catch {}

  const raw = JSON.parse(readFileSync(path.resolve(file), "utf8"));
  const prompts = Array.isArray(raw) ? raw : [raw];
  const now = Date.now();
  let n = 0;
  for (const p of prompts) {
    if (!p.task_type || !p.prompt_text) {
      console.error("Skipping prompt missing task_type/prompt_text:", p.title ?? "(untitled)");
      continue;
    }
    const id = p.id ?? randomUUID();
    await db.execute({
      sql: `INSERT OR REPLACE INTO writing_prompts
        (id, task_type, title, prompt_text, image_path, chart_data, model_answer, source_file, tags, last_shown, created_at, user_id)
        VALUES (?,?,?,?,?,?,?,?,?,COALESCE((SELECT last_shown FROM writing_prompts WHERE id=?),0),?,?)`,
      args: [
        id, p.task_type, p.title ?? "", p.prompt_text,
        p.image_path ?? null,
        p.chart_data ? JSON.stringify(p.chart_data) : null,
        p.model_answer ?? null, p.source_file ?? null,
        JSON.stringify(p.tags ?? []), id, now, OWNER_ID,
      ],
    });
    n++;
  }
  console.log(`Stored ${n} prompt(s).`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
