import { describe, it, expect } from "vitest";
import { paginate } from "../lib/admin/paginate";

const items = Array.from({ length: 23 }, (_, i) => i + 1); // [1..23]

describe("paginate", () => {
  it("returns the first page slice with correct flags", () => {
    const p = paginate(items, 1, 10);
    expect(p.items).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(p).toMatchObject({ page: 1, pageCount: 3, total: 23, hasPrev: false, hasNext: true });
  });

  it("returns a middle page", () => {
    const p = paginate(items, 2, 10);
    expect(p.items).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(p).toMatchObject({ hasPrev: true, hasNext: true });
  });

  it("returns a short final page", () => {
    const p = paginate(items, 3, 10);
    expect(p.items).toEqual([21, 22, 23]);
    expect(p).toMatchObject({ page: 3, hasPrev: true, hasNext: false });
  });

  it("clamps an out-of-range page into bounds", () => {
    expect(paginate(items, 99, 10).page).toBe(3);
    expect(paginate(items, 0, 10).page).toBe(1);
    expect(paginate(items, -5, 10).page).toBe(1);
  });

  it("handles an empty list without going below page 1", () => {
    const p = paginate([], 1, 10);
    expect(p).toMatchObject({ items: [], page: 1, pageCount: 1, total: 0, hasPrev: false, hasNext: false });
  });
});
