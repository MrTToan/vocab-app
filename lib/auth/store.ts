import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

/*
 * User account storage — the `users` table over the same libSQL DB. Kept tiny
 * and separate from the vocab/writing stores. On Google sign-in we upsert by
 * email: an existing email (e.g. the owner row the migration created with id
 * `local-user`) keeps its id, so the owner's data reunites with their account;
 * a new email gets a fresh uuid.
 */

let db: any = null;
let ready: Promise<void> | null = null;

async function connect(): Promise<any> {
  if (!ready) {
    ready = (async () => {
      const { createClient } = await import("@libsql/client");
      let url = process.env.DATABASE_URL;
      if (!url) {
        const dir = path.join(process.cwd(), ".data");
        await fs.mkdir(dir, { recursive: true });
        url = `file:${path.join(dir, "lexi.db")}`;
      } else if (url.startsWith("file:")) {
        await fs.mkdir(path.dirname(path.resolve(url.slice(5))), { recursive: true });
      }
      db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
      await db.execute(
        `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, name TEXT, image TEXT, created_at INTEGER)`,
      );
      await db.execute(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email)`,
      );
    })();
  }
  await ready;
  return db;
}

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

/** Insert-or-fetch a user by email; returns the stable DB user id. */
export async function upsertUser(input: {
  email: string;
  name?: string | null;
  image?: string | null;
}): Promise<string> {
  const email = input.email.trim().toLowerCase();
  const c = await connect();
  const existing = await c.execute({
    sql: "SELECT id FROM users WHERE email = ? LIMIT 1",
    args: [email],
  });
  if (existing.rows[0]) {
    const id = String(existing.rows[0].id);
    // opportunistically refresh display fields
    await c.execute({
      sql: "UPDATE users SET name = ?, image = ? WHERE id = ?",
      args: [input.name ?? null, input.image ?? null, id],
    });
    return id;
  }
  const id = randomUUID();
  await c.execute({
    sql: "INSERT INTO users (id, email, name, image, created_at) VALUES (?,?,?,?,?)",
    args: [id, email, input.name ?? null, input.image ?? null, Date.now()],
  });
  return id;
}
