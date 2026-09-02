import { describe, it, expect, beforeAll } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { createClient, type Client } from "@libsql/client";
import { migrate } from "../lib/db";

/*
 * v2 adoption migration: writing questions became an ADMIN-managed bank, so any
 * prompt a regular user created before this (owner_id = a real user id) is
 * adopted into the shared bank as a DRAFT (owner_id=__system__, visibility=
 * private) — never auto-published, no row deleted, and `user_id` (the original
 * author) preserved. The shared bank's existing published prompts are untouched.
 */

let db: Client;

async function count(): Promise<number> {
  const r = await db.execute("SELECT COUNT(*) n FROM writing_prompts");
  return Number(r.rows[0]?.n ?? 0);
}
async function row(id: string) {
  const r = await db.execute({ sql: "SELECT * FROM writing_prompts WHERE id=?", args: [id] });
  return r.rows[0] as Record<string, unknown> | undefined;
}
async function setVersion(v: number) {
  await db.execute("DELETE FROM schema_version");
  await db.execute({ sql: "INSERT INTO schema_version (version) VALUES (?)", args: [v] });
}

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-wpmig-"));
  db = createClient({ url: `file:${path.join(dir, "t.db")}` });
  // Build the schema first (fresh → v2, empty).
  await migrate(db);

  // Plant pre-migration rows, then rewind the schema version so the one-time
  // adoption step re-runs on the next migrate() (simulating an older DB).
  await db.execute({
    sql: `INSERT INTO writing_prompts (id, task_type, title, prompt_text, tags, created_at, user_id, owner_id, visibility)
          VALUES ('u1', 'task2', 'User essay', 'A user-authored essay prompt.', '[]', 1, 'user-x', 'user-x', 'private')`,
    args: [],
  });
  await db.execute({
    sql: `INSERT INTO writing_prompts (id, task_type, title, prompt_text, tags, created_at, user_id, owner_id, visibility)
          VALUES ('u2', 'task1', 'User chart', 'A user-authored chart prompt.', '[]', 2, 'user-y', 'user-y', 'private')`,
    args: [],
  });
  await db.execute({
    sql: `INSERT INTO writing_prompts (id, task_type, title, prompt_text, tags, created_at, user_id, owner_id, visibility)
          VALUES ('bank', 'task2', 'Bank essay', 'A curated bank prompt.', '[]', 3, 'local-user', '__system__', 'public')`,
    args: [],
  });
  await setVersion(1);
});

describe("v2 writing-prompt adoption", () => {
  it("adopts user-created prompts as drafts, preserves author, loses nothing, leaves the bank alone", async () => {
    const before = await count();
    await migrate(db);
    expect(await count()).toBe(before); // no row lost

    const u1 = await row("u1");
    expect(u1?.owner_id).toBe("__system__"); // adopted into the admin bank
    expect(u1?.visibility).toBe("private"); // as a DRAFT — not auto-published
    expect(u1?.user_id).toBe("user-x"); // original author preserved

    const u2 = await row("u2");
    expect(u2?.owner_id).toBe("__system__");
    expect(u2?.visibility).toBe("private");
    expect(u2?.user_id).toBe("user-y");

    const bank = await row("bank");
    expect(bank?.owner_id).toBe("__system__"); // untouched
    expect(bank?.visibility).toBe("public"); // stays published
  });

  it("is idempotent — a second migrate() does not re-touch or drop anything", async () => {
    const before = await count();
    await migrate(db); // already at v2 → adoption gated off
    expect(await count()).toBe(before);
    expect((await row("u1"))?.visibility).toBe("private");
    expect((await row("bank"))?.visibility).toBe("public");
  });
});
