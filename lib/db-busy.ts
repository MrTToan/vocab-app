/*
 * Early-warning signal for SQLite write-contention.
 *
 * Lexi runs libSQL over a local SQLite file in WAL mode with a 5 s busy_timeout
 * (see lib/db.ts). That timeout absorbs *short* lock waits, but under heavy
 * concurrent writes SQLite still surfaces `SQLITE_BUSY` / "database is locked"
 * once the wait exceeds the timeout — the practical write-concurrency ceiling
 * for this single-file deployment.
 *
 * This module is OBSERVE-ONLY: it detects such errors at the single DB
 * chokepoint (the memoized client's execute/batch, wrapped in lib/db.ts),
 * logs one greppable line and bumps a lightweight in-process tally, then the
 * caller RE-THROWS. It never swallows the error, retries, or changes the
 * busy_timeout — a non-zero, climbing count is simply the signal that the
 * captain is approaching the ceiling. The tally is surfaced cheaply on
 * `/api/health` and in the admin stats.
 */

/** How far back the rolling `recent` count looks (resets naturally as it ages out). */
const RECENT_WINDOW_MS = 5 * 60_000; // 5 minutes

let total = 0;
let lastSeenAt: number | null = null;
/** Timestamps (ms) of recent busy hits, pruned to the rolling window on each read/write. */
let recent: number[] = [];

/** Public snapshot of the busy tally. Cheap to build; safe to serialize. */
export type DbBusyStats = {
  /** Total BUSY/LOCKED errors observed since this process booted. */
  total: number;
  /** How many of those fell within the last RECENT_WINDOW_MS. */
  recent: number;
  /** Epoch ms of the most recent busy error, or null if none seen. */
  lastSeenAt: number | null;
  /** The rolling window width in ms, so a reader can label `recent`. */
  windowMs: number;
};

function prune(now: number): void {
  const cutoff = now - RECENT_WINDOW_MS;
  if (recent.length && recent[0] < cutoff) {
    recent = recent.filter((t) => t >= cutoff);
  }
}

/**
 * Does this thrown value indicate SQLite write-contention? Primary signal is the
 * libSQL error `code` (`SQLITE_BUSY`/`SQLITE_LOCKED`, or an extended variant like
 * `SQLITE_BUSY_SNAPSHOT`); a message-substring check is the fallback for anything
 * that reaches us without a code (e.g. re-wrapped errors).
 */
export function isBusyError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string") {
    const c = code.toUpperCase();
    if (c.startsWith("SQLITE_BUSY") || c.startsWith("SQLITE_LOCKED")) return true;
  }
  const msg =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const m = msg.toLowerCase();
  return (
    m.includes("database is locked") ||
    m.includes("database table is locked") ||
    m.includes("sqlite_busy") ||
    m.includes("sqlite_locked")
  );
}

/**
 * Record one busy hit: bump the tally and log a single greppable warning line.
 * Call this ONLY after confirming `isBusyError`; it never inspects behaviour and
 * never suppresses the error (the caller re-throws).
 */
export function recordBusy(err: unknown, op: string): void {
  const now = Date.now();
  total += 1;
  lastSeenAt = now;
  prune(now);
  recent.push(now);
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: unknown } | null)?.code;
  console.warn(
    `[db][busy] database is locked (SQLITE_BUSY) op=${op} code=${
      typeof code === "string" ? code : "?"
    } total=${total} recent=${recent.length}: ${msg}`,
  );
}

/** Current busy tally. Read-only; safe for the health probe and admin stats. */
export function getDbBusyStats(): DbBusyStats {
  prune(Date.now());
  return { total, recent: recent.length, lastSeenAt, windowMs: RECENT_WINDOW_MS };
}

/** Test-only: reset the in-process tally. */
export function __resetDbBusyStats(): void {
  total = 0;
  lastSeenAt = null;
  recent = [];
}
