import { describe, it, expect, beforeAll } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { createClient, type Client } from "@libsql/client";
import { migrate } from "../lib/db";

/*
 * The `feedback` table (in-app feedback widget). A plain idempotent CREATE TABLE
 * + indexes — no version-gated backfill — so this just proves migrate() creates
 * the table with the expected columns/indexes, that a row round-trips, and that
 * re-running migrate() is a no-op that preserves the data.
 */

let db: Client;

async function columns(): Promise<string[]> {
  const r = await db.execute("PRAGMA table_info(feedback)");
  return (r.rows as Record<string, unknown>[]).map((x) => String(x.name));
}
async function indexes(): Promise<string[]> {
  const r = await db.execute(
    "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='feedback'",
  );
  return (r.rows as Record<string, unknown>[]).map((x) => String(x.name));
}

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-fbmig-"));
  db = createClient({ url: `file:${path.join(dir, "t.db")}` });
  await migrate(db);
});

describe("feedback table migration", () => {
  it("creates the feedback table with the expected columns", async () => {
    expect(await columns()).toEqual([
      "id",
      "user_id",
      "category",
      "rating",
      "message",
      "page",
      "user_agent",
      "created_at",
    ]);
  });

  it("creates the created-at and per-user indexes", async () => {
    const idx = await indexes();
    expect(idx).toContain("idx_feedback_created");
    expect(idx).toContain("idx_feedback_user");
  });

  it("round-trips a row (rating may be NULL)", async () => {
    await db.execute({
      sql: `INSERT INTO feedback (id, user_id, category, rating, message, page, user_agent, created_at)
            VALUES (?,?,?,?,?,?,?,?)`,
      args: ["f1", "user-x", "idea", null, "Add dark mode", "/library", "UA", 123],
    });
    const r = await db.execute({ sql: "SELECT * FROM feedback WHERE id=?", args: ["f1"] });
    const row = r.rows[0] as Record<string, unknown>;
    expect(row.category).toBe("idea");
    expect(row.rating).toBe(null);
    expect(row.message).toBe("Add dark mode");
    expect(row.page).toBe("/library");
    expect(Number(row.created_at)).toBe(123);
  });

  it("is idempotent: re-running migrate() keeps the data", async () => {
    await migrate(db);
    const r = await db.execute("SELECT COUNT(*) n FROM feedback");
    expect(Number(r.rows[0]?.n ?? 0)).toBe(1);
  });
});
