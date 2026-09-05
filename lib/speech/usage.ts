/*
 * Azure free-tier monthly usage tally.
 *
 * The whole point is to make the "Azure budget exhausted → fall back to OpenAI"
 * switch real. We keep a per-UTC-month running total of the two Azure metrics we
 * spend against the free F0 tier:
 *   - `tts_chars`      → characters synthesized (TTS)
 *   - `assess_seconds` → seconds of audio sent for Pronunciation Assessment
 *
 * Stored in the shared SQLite (`speech_usage` table, created in lib/db.ts
 * migrate()). Increment is one atomic upsert; the check is a plain read. This is
 * deliberately approximate — we round assessment seconds up and count TTS chars
 * as-sent. If the tally is ever wrong we simply try Azure and let its own error
 * fall back (see index.ts), so we never over-engineer exact metering.
 *
 * Only Azure is tracked; OpenAI is metered by the per-user LLM quota ledger.
 */

import { getDb } from "@/lib/db";

export type AzureMetric = "tts_chars" | "assess_seconds";

/** UTC month key, "YYYY-MM". */
export function utcMonth(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/** Current month's total for a metric (0 when nothing recorded yet). */
export async function azureUsage(
  metric: AzureMetric,
  month: string = utcMonth(),
): Promise<number> {
  try {
    const db = await getDb();
    const rs = await db.execute({
      sql: "SELECT amount FROM speech_usage WHERE month=? AND metric=?",
      args: [month, metric],
    });
    return Number(rs.rows[0]?.amount ?? 0);
  } catch {
    // A tally read must never block the feature — treat an error as "unknown, 0"
    // so we still try Azure (and fall back on its own error if it's truly out).
    return 0;
  }
}

/**
 * True when this month's Azure usage of `metric` is already at/over `budget`
 * (so the caller should skip Azure and use OpenAI). `pending` is the size of the
 * about-to-be-made request, so we also refuse a call that would clearly blow the
 * budget. Any error → false (prefer trying Azure, fall back on its error).
 */
export async function azureBudgetExceeded(
  metric: AzureMetric,
  budget: number,
  pending = 0,
): Promise<boolean> {
  const used = await azureUsage(metric);
  return used >= budget || used + pending > budget;
}

/** Add `amount` to this month's tally for `metric` (atomic upsert). Best-effort:
 *  a failed record never fails the user's request. */
export async function recordAzureUsage(
  metric: AzureMetric,
  amount: number,
): Promise<void> {
  if (!(amount > 0)) return;
  try {
    const db = await getDb();
    await db.execute({
      sql: `INSERT INTO speech_usage (month, metric, amount) VALUES (?,?,?)
            ON CONFLICT(month, metric) DO UPDATE SET amount = amount + ?`,
      args: [utcMonth(), metric, Math.ceil(amount), Math.ceil(amount)],
    });
  } catch (err) {
    console.warn(
      `[speech] usage record failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
