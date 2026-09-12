import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { Client } from "@libsql/client";
import {
  isBusyError,
  recordBusy,
  getDbBusyStats,
  __resetDbBusyStats,
} from "../lib/db-busy";
import { withBusyDetection } from "../lib/db";

/*
 * The observe-only SQLITE_BUSY / "database is locked" early-warning signal
 * (lib/db-busy.ts) and the chokepoint wrapper in lib/db.ts. A simulated busy
 * error must be DETECTED, COUNTED, and still RE-THROWN unchanged — this is
 * observe-only and must never swallow the error or change behaviour.
 */

/** A libSQL-shaped busy error: `.code` is the primary signal (see @libsql/client). */
class FakeLibsqlError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "LibsqlError";
    this.code = code;
  }
}

beforeEach(() => __resetDbBusyStats());
afterEach(() => vi.restoreAllMocks());

describe("isBusyError", () => {
  it("detects by the libSQL code (SQLITE_BUSY / SQLITE_LOCKED, incl. extended)", () => {
    expect(isBusyError(new FakeLibsqlError("database is locked", "SQLITE_BUSY"))).toBe(true);
    expect(isBusyError(new FakeLibsqlError("locked", "SQLITE_LOCKED"))).toBe(true);
    expect(isBusyError(new FakeLibsqlError("x", "SQLITE_BUSY_SNAPSHOT"))).toBe(true);
  });

  it("falls back to the message when there is no code", () => {
    expect(isBusyError(new Error("database is locked"))).toBe(true);
    expect(isBusyError("SQLITE_BUSY: database is locked")).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isBusyError(new FakeLibsqlError("no such table: words", "SQLITE_ERROR"))).toBe(false);
    expect(isBusyError(new Error("constraint failed"))).toBe(false);
    expect(isBusyError(null)).toBe(false);
    expect(isBusyError(undefined)).toBe(false);
  });
});

describe("recordBusy + getDbBusyStats", () => {
  it("increments total/recent and stamps lastSeenAt, logging one greppable line", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getDbBusyStats()).toMatchObject({ total: 0, recent: 0, lastSeenAt: null });

    recordBusy(new FakeLibsqlError("database is locked", "SQLITE_BUSY"), "execute");
    recordBusy(new FakeLibsqlError("database is locked", "SQLITE_BUSY"), "batch");

    const stats = getDbBusyStats();
    expect(stats.total).toBe(2);
    expect(stats.recent).toBe(2);
    expect(stats.lastSeenAt).toBeTypeOf("number");
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0][0])).toContain("[db][busy]");
  });
});

describe("withBusyDetection chokepoint wrapper", () => {
  it("detects, counts, and RE-THROWS a busy error from execute()", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const busy = new FakeLibsqlError("database is locked", "SQLITE_BUSY");
    const client = {
      execute: vi.fn().mockRejectedValue(busy),
      batch: vi.fn().mockResolvedValue([]),
    } as unknown as Client;

    const wrapped = withBusyDetection(client);

    await expect(wrapped.execute("INSERT INTO t VALUES (1)")).rejects.toBe(busy);
    expect(getDbBusyStats().total).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("counts busy errors from batch() too, and re-throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const busy = new FakeLibsqlError("database is locked", "SQLITE_BUSY");
    const client = {
      execute: vi.fn().mockResolvedValue({ rows: [] }),
      batch: vi.fn().mockRejectedValue(busy),
    } as unknown as Client;

    const wrapped = withBusyDetection(client);

    await expect(wrapped.batch([])).rejects.toBe(busy);
    expect(getDbBusyStats().total).toBe(1);
  });

  it("passes non-busy errors through WITHOUT counting them", async () => {
    const other = new FakeLibsqlError("no such table: words", "SQLITE_ERROR");
    const client = {
      execute: vi.fn().mockRejectedValue(other),
      batch: vi.fn(),
    } as unknown as Client;

    const wrapped = withBusyDetection(client);

    await expect(wrapped.execute("SELECT 1")).rejects.toBe(other);
    expect(getDbBusyStats().total).toBe(0);
  });

  it("does not interfere with successful calls", async () => {
    const client = {
      execute: vi.fn().mockResolvedValue({ rows: [{ v: 1 }] }),
      batch: vi.fn().mockResolvedValue([]),
    } as unknown as Client;

    const wrapped = withBusyDetection(client);

    await expect(wrapped.execute("SELECT 1")).resolves.toEqual({ rows: [{ v: 1 }] });
    expect(getDbBusyStats().total).toBe(0);
  });
});
