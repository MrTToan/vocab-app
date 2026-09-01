import { describe, it, expect } from "vitest";
import {
  ymdUTC,
  lastNDaysUTC,
  shortDayLabel,
  fillDailySeries,
  cumulative,
} from "../lib/admin/aggregate";

// A fixed "now" in the middle of a UTC day so tests are timezone-independent.
const NOW = Date.UTC(2026, 8, 1, 15, 30); // 2026-09-01T15:30Z

describe("ymdUTC", () => {
  it("formats an epoch-ms timestamp as a UTC day key", () => {
    expect(ymdUTC(NOW)).toBe("2026-09-01");
  });
  it("uses UTC, not local time, at day boundaries", () => {
    // 2026-09-01T23:30Z is still Sep 1 in UTC regardless of the runner's TZ.
    expect(ymdUTC(Date.UTC(2026, 8, 1, 23, 30))).toBe("2026-09-01");
  });
});

describe("lastNDaysUTC", () => {
  it("returns n contiguous day keys ending today, oldest→newest", () => {
    expect(lastNDaysUTC(3, NOW)).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
    ]);
  });
  it("crosses month boundaries correctly", () => {
    const days = lastNDaysUTC(2, Date.UTC(2026, 2, 1, 1, 0)); // Mar 1
    expect(days).toEqual(["2026-02-28", "2026-03-01"]);
  });
});

describe("shortDayLabel", () => {
  it("renders M/D without leading zeros", () => {
    expect(shortDayLabel("2026-09-01")).toBe("9/1");
    expect(shortDayLabel("2026-12-25")).toBe("12/25");
  });
});

describe("fillDailySeries", () => {
  it("zero-fills missing days across the window", () => {
    const rows = [{ day: "2026-09-01", count: 5 }];
    const series = fillDailySeries(rows, 3, NOW);
    expect(series.map((p) => p.count)).toEqual([0, 0, 5]);
    expect(series.map((p) => p.day)).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
    ]);
    expect(series.at(-1)!.label).toBe("9/1");
  });
  it("drops rows outside the window", () => {
    const rows = [
      { day: "2026-01-01", count: 99 }, // far outside
      { day: "2026-08-31", count: 2 },
    ];
    const series = fillDailySeries(rows, 3, NOW);
    expect(series.map((p) => p.count)).toEqual([0, 2, 0]);
  });
  it("honours a custom pick selector", () => {
    const rows = [{ day: "2026-09-01", attempts: 7, users: 3 }];
    const series = fillDailySeries(rows, 2, NOW, (r) => r.users);
    expect(series.at(-1)!.count).toBe(3);
  });
});

describe("cumulative", () => {
  it("produces a running total, keeping day/label", () => {
    const base = fillDailySeries(
      [
        { day: "2026-08-30", count: 1 },
        { day: "2026-08-31", count: 2 },
        { day: "2026-09-01", count: 3 },
      ],
      3,
      NOW,
    );
    const cum = cumulative(base);
    expect(cum.map((p) => p.count)).toEqual([1, 3, 6]);
    expect(cum.map((p) => p.day)).toEqual(base.map((p) => p.day));
  });
});
