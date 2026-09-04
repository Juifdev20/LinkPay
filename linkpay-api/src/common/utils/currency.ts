/**
 * Groups a set of rows (each carrying its own `currency`) into a
 * {CDF, USD} sum of the given field — the shared helper for every stats
 * endpoint that used to sum amounts across currencies into one meaningless
 * figure. Rows with no/unrecognized currency are treated as CDF, matching
 * every other currency column's DEFAULT 'CDF' in this schema.
 */
export function sumByCurrency<T extends { currency?: string | null; [key: string]: any }>(
  rows: T[] | null | undefined,
  field: string,
): { CDF: number; USD: number } {
  const result = { CDF: 0, USD: 0 };
  for (const row of rows || []) {
    const key = row.currency === 'USD' ? 'USD' : 'CDF';
    result[key] += row[field] || 0;
  }
  return result;
}
