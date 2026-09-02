import { randomUUID } from "crypto";

/*
 * User account storage — the `users` table over the same libSQL DB. Kept tiny
 * and separate from the vocab/writing stores. On Google sign-in we upsert by
 * email: an existing email (e.g. the owner row the migration created with id
 * `local-user`) keeps its id, so the owner's data reunites with their account;
 * a new email gets a fresh uuid.
 */

import { getDb } from "../db";

async function connect() {
  // Shared process-wide client; the `users` table + unique email index are
  // created by migrate() in lib/db.ts before this resolves.
  return getDb();
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

/** A user's stored email (lowercased) by id, or null. Used by the owner check. */
export async function getUserEmail(userId: string): Promise<string | null> {
  const c = await connect();
  const rs = await c.execute({
    sql: "SELECT email FROM users WHERE id = ? LIMIT 1",
    args: [userId],
  });
  const email = rs.rows[0]?.email;
  return email ? String(email).toLowerCase() : null;
}
