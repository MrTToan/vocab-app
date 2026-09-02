import { describe, it, expect, beforeAll } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { createClient, type Client } from "@libsql/client";
import { migrate } from "../lib/db";

/*
 * Regression guard for the practice "Check my answer" result vanishing.
 *
 * Words created before the multi-tenant split (single-tenant era) have
 * `owner_id` NULL — the column was added without a backfill. But every content
 * read gates on it: `store.get()` fetches only `owner_id = __system__ OR
 * owner_id = <caller>`, so a NULL-owner word is invisible to EVERYONE. That
 * silently breaks the practice loop — `/api/practice/next` serves such a word
 * (it scopes by user_words membership, not owner_id), but `/api/practice/score`
 * and `/api/practice/result` then 404 on it, so LLM-graded "Check my answer"
 * shows no result while locally-graded cards still show client-side feedback.
 *
 * The migration must promote these pre-split rows to the shared catalogue
 * (`__system__`) — mirroring the writing-prompt bank — so they stay fetchable.
 */

let db: Client;

async function ownerOf(id: string): Promise<unknown> {
  const r = await db.execute({ sql: "SELECT owner_id FROM words WHERE id=?", args: [id] });
  return r.rows[0]?.owner_id;
}
async function nullOwnerCount(): Promise<number> {
  const r = await db.execute(
    "SELECT COUNT(*) n FROM words WHERE owner_id IS NULL OR owner_id = ''",
  );
  return Number(r.rows[0]?.n ?? 0);
}

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lexi-wordbf-"));
  db = createClient({ url: `file:${path.join(dir, "t.db")}` });
  await migrate(db); // build the schema

  // Plant pre-split rows: a NULL owner_id, an empty-string owner_id (both
  // orphaned), and a properly-owned word that must be left untouched.
  await db.execute("INSERT INTO words (id, word, owner_id) VALUES ('legacy', 'ubiquitous', NULL)");
  await db.execute("INSERT INTO words (id, word, owner_id) VALUES ('legacyEmpty', 'candid', '')");
  await db.execute("INSERT INTO words (id, word, owner_id) VALUES ('owned', 'mine', 'user-x')");
});

describe("words owner_id backfill", () => {
  it("promotes orphaned (NULL/'') owner_id words to the shared catalogue so they stay fetchable", async () => {
    expect(await nullOwnerCount()).toBe(2); // orphans exist before

    await migrate(db);

    expect(await ownerOf("legacy")).toBe("__system__");
    expect(await ownerOf("legacyEmpty")).toBe("__system__");
    expect(await ownerOf("owned")).toBe("user-x"); // a real owner is never rewritten
    expect(await nullOwnerCount()).toBe(0); // no orphan survives
  });

  it("is idempotent and never touches an already-owned word", async () => {
    await migrate(db);
    expect(await ownerOf("legacy")).toBe("__system__");
    expect(await ownerOf("owned")).toBe("user-x");
    expect(await nullOwnerCount()).toBe(0);
  });
});
