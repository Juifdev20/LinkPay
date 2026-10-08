/**
 * Query-string page/limit for list endpoints. `limit` is capped: an
 * unbounded `?limit=1000000` made one request pull a whole table.
 */
export const MAX_PAGE_LIMIT = 100;

export function toPage(page?: string): number {
  const n = parseInt(page ?? '', 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export function toLimit(limit?: string, fallback = 20): number {
  const n = parseInt(limit ?? '', 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, MAX_PAGE_LIMIT);
}
