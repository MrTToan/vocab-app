/**
 * Pure client-side pagination helper for small, already-ranked lists (e.g. the
 * admin "Most active users" table). Keeps the page index in bounds so a stale
 * page (list shrank, or an out-of-range request) never renders an empty slice.
 */
export interface Page<T> {
  items: T[]; // the current page's slice
  page: number; // 1-based, clamped into [1, pageCount]
  pageCount: number; // total pages (>= 1, even when empty)
  total: number; // total item count
  hasPrev: boolean;
  hasNext: boolean;
}

export function paginate<T>(items: T[], page: number, perPage: number): Page<T> {
  const total = items.length;
  const size = Math.max(1, Math.floor(perPage));
  const pageCount = Math.max(1, Math.ceil(total / size));
  const clamped = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (clamped - 1) * size;
  return {
    items: items.slice(start, start + size),
    page: clamped,
    pageCount,
    total,
    hasPrev: clamped > 1,
    hasNext: clamped < pageCount,
  };
}
