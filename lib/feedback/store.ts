/*
 * Feedback store — the in-app "Feedback" widget's submissions.
 *
 * A small self-contained module in the spirit of lib/writing/store.ts: the
 * `feedback` table, its indexes and the shared client all live in migrate()
 * (lib/db.ts) / getDb() — this file only reads and writes rows.
 *
 * Call sites use feedbackStore.forUser(userId) to submit (a write scoped to the
 * signed-in user); the owner-only admin list uses feedbackStore.listAll().
 */

import { randomUUID } from "crypto";
import { getDb } from "../db";
import {
  FEEDBACK_CATEGORIES,
  type FeedbackCategory,
  type FeedbackEntry,
  type NewFeedback,
} from "./types";

async function connect(): Promise<any> {
  return getDb();
}

function coerceCategory(v: unknown): FeedbackCategory {
  return (FEEDBACK_CATEGORIES as readonly string[]).includes(String(v))
    ? (v as FeedbackCategory)
    : "other";
}

function rowToEntry(r: Record<string, unknown>): FeedbackEntry {
  return {
    id: String(r.id),
    user_id: String(r.user_id ?? ""),
    category: coerceCategory(r.category),
    rating: r.rating == null ? null : Number(r.rating),
    message: String(r.message ?? ""),
    page: String(r.page ?? ""),
    user_agent: String(r.user_agent ?? ""),
    created_at: Number(r.created_at ?? 0),
    user_email: r.user_email == null ? "" : String(r.user_email),
    user_name: r.user_name == null ? "" : String(r.user_name),
  };
}

const raw = {
  async add(userId: string, input: NewFeedback): Promise<FeedbackEntry> {
    const c = await connect();
    const entry: FeedbackEntry = {
      id: randomUUID(),
      user_id: userId,
      category: coerceCategory(input.category),
      rating: input.rating == null ? null : Number(input.rating),
      message: input.message,
      page: input.page ?? "",
      user_agent: input.user_agent ?? "",
      created_at: Date.now(),
    };
    await c.execute({
      sql: `INSERT INTO feedback (id, user_id, category, rating, message, page, user_agent, created_at)
            VALUES (?,?,?,?,?,?,?,?)`,
      args: [
        entry.id,
        entry.user_id,
        entry.category,
        entry.rating,
        entry.message,
        entry.page,
        entry.user_agent,
        entry.created_at,
      ],
    });
    return entry;
  },

  /** Owner-only: every submission, newest first, with the submitter's identity. */
  async listAll(): Promise<FeedbackEntry[]> {
    const c = await connect();
    const rs = await c.execute(
      `SELECT f.*, u.email AS user_email, u.name AS user_name
         FROM feedback f
         LEFT JOIN users u ON u.id = f.user_id
        ORDER BY f.created_at DESC`,
    );
    return (rs.rows as Record<string, unknown>[]).map(rowToEntry);
  },
};

export interface FeedbackScope {
  /** Submit one feedback entry as this user. */
  add(input: NewFeedback): Promise<FeedbackEntry>;
}

export const feedbackStore = {
  /** A view of the store scoped to one signed-in user (submissions). */
  forUser(userId: string): FeedbackScope {
    return {
      add: (input) => raw.add(userId, input),
    };
  },

  /** Owner-only: read every submission for the admin "Feedback" subtab. */
  listAll(): Promise<FeedbackEntry[]> {
    return raw.listAll();
  },
};
