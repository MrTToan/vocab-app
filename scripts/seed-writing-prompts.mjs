#!/usr/bin/env node
// Seed a handful of IELTS Academic Task 2 prompts into writing_prompts.
// Idempotent: deterministic ids + INSERT OR REPLACE, so re-running is safe.
// Usage: node scripts/seed-writing-prompts.mjs   (respects DATABASE_URL, else .data/lexi.db)
import { createClient } from "@libsql/client";
import path from "path";

const url = process.env.DATABASE_URL || `file:${path.join(process.cwd(), ".data", "lexi.db")}`;
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });

const TASK2 = [
  {
    title: "Technology and human connection",
    prompt_text:
      "Some people believe that modern communication technology brings people closer together, while others think it isolates them. Discuss both views and give your own opinion.",
  },
  {
    title: "University education funding",
    prompt_text:
      "Some people think that university education should be free for all students, while others believe students should pay their own tuition fees. To what extent do you agree or disagree?",
  },
  {
    title: "Working from home",
    prompt_text:
      "In many countries, an increasing number of people work from home rather than in an office. Do the advantages of this development outweigh the disadvantages?",
  },
  {
    title: "City living and stress",
    prompt_text:
      "Many people who live in large cities experience high levels of stress. What are the causes of this, and what measures could be taken to reduce it?",
  },
  {
    title: "Protecting the environment",
    prompt_text:
      "Some argue that protecting the environment is the responsibility of governments, while others believe individuals must take action. Discuss both views and give your own opinion.",
  },
];

async function main() {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS writing_prompts (
      id TEXT PRIMARY KEY, task_type TEXT, title TEXT, prompt_text TEXT,
      image_path TEXT, chart_data TEXT, model_answer TEXT, source_file TEXT,
      tags TEXT, last_shown INTEGER DEFAULT 0, created_at INTEGER, user_id TEXT
    )`,
  );
  try { await db.execute("ALTER TABLE writing_prompts ADD COLUMN user_id TEXT"); } catch {}
  const OWNER_ID = process.env.SEED_USER_ID || "local-user";
  const now = Date.now();
  let n = 0;
  for (let i = 0; i < TASK2.length; i++) {
    const p = TASK2[i];
    const id = `seed-task2-${i + 1}`;
    await db.execute({
      sql: `INSERT OR REPLACE INTO writing_prompts
        (id, task_type, title, prompt_text, image_path, chart_data, model_answer, source_file, tags, last_shown, created_at, user_id)
        VALUES (?,?,?,?,?,?,?,?,?,COALESCE((SELECT last_shown FROM writing_prompts WHERE id=?),0),?,?)`,
      args: [id, "task2", p.title, p.prompt_text, null, null, null, "seed", JSON.stringify(["seed"]), id, now, OWNER_ID],
    });
    n++;
  }
  const c = await db.execute("SELECT COUNT(*) n FROM writing_prompts WHERE task_type='task2'");
  console.log(`Seeded ${n} Task 2 prompts. Total Task 2 prompts in bank: ${c.rows[0].n}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
