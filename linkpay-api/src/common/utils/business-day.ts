/**
 * "Today" for a business is decided by the server in one fixed timezone, never by
 * the phone's clock or the host's local zone — otherwise the home hero, the chart
 * and the station chips each cut the day at a different instant and disagree.
 */
export const BUSINESS_TZ = 'Africa/Lubumbashi';

const DAY_MS = 24 * 60 * 60 * 1000;

function partsIn(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), mi: get('minute'), s: get('second') };
}

/** YYYY-MM-DD of `date` in the business timezone. */
export function businessDayKey(date: Date | string, tz = BUSINESS_TZ): string {
  const { y, m, d } = partsIn(new Date(date), tz);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** The UTC instant at which `date`'s business day began (local midnight). */
export function startOfBusinessDay(date: Date = new Date(), tz = BUSINESS_TZ): Date {
  const { y, m, d, h, mi, s } = partsIn(date, tz);
  const localAsUtc = Date.UTC(y, m - 1, d, h, mi, s);
  const offsetMs = localAsUtc - Math.floor(date.getTime() / 1000) * 1000; // tz offset at `date`
  return new Date(Date.UTC(y, m - 1, d) - offsetMs);
}

/** The last `n` business-day keys, oldest first, today last. */
export function lastBusinessDays(n: number, now: Date = new Date(), tz = BUSINESS_TZ): string[] {
  const todayStart = startOfBusinessDay(now, tz).getTime();
  return Array.from({ length: n }, (_, i) => businessDayKey(new Date(todayStart - (n - 1 - i) * DAY_MS + DAY_MS / 2), tz));
}

// ---------------------------------------------------------------------------
// Calendar ranges in the business timezone: [from, to) as UTC instants, built from
// day keys (YYYY-MM-DD). Used by the cash book and the periodic reports.
// ---------------------------------------------------------------------------

const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `key` shifted by `days` calendar days (pure calendar arithmetic). */
export function addDaysToKey(key: string, days: number): string {
  const m = KEY_RE.exec(key);
  if (!m) throw new Error(`Invalid day key: ${key}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** The UTC instant at which the business day `key` begins. */
export function startOfBusinessDayKey(key: string, tz = BUSINESS_TZ): Date {
  const m = KEY_RE.exec(key);
  if (!m) throw new Error(`Invalid day key: ${key}`);
  // Noon UTC always falls inside the same calendar day in the business timezone (UTC+2, no DST).
  return startOfBusinessDay(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)), tz);
}

export type BusinessRange = { from: Date; to: Date; first_day: string; last_day: string };

/** One business day, [from, to). */
export function businessDayRange(key: string, tz = BUSINESS_TZ): BusinessRange {
  return { from: startOfBusinessDayKey(key, tz), to: startOfBusinessDayKey(addDaysToKey(key, 1), tz), first_day: key, last_day: key };
}

/** The ISO week (Monday to Sunday) containing `key`. */
export function businessWeekRange(key: string, tz = BUSINESS_TZ): BusinessRange {
  const m = KEY_RE.exec(key)!;
  const dow = (new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay() + 6) % 7; // Monday = 0
  const first = addDaysToKey(key, -dow);
  const next = addDaysToKey(first, 7);
  return { from: startOfBusinessDayKey(first, tz), to: startOfBusinessDayKey(next, tz), first_day: first, last_day: addDaysToKey(next, -1) };
}

/** The calendar month of `month` (YYYY-MM) or of a day key. */
export function businessMonthRange(month: string, tz = BUSINESS_TZ): BusinessRange {
  const m = /^(\d{4})-(\d{2})/.exec(month);
  if (!m) throw new Error(`Invalid month: ${month}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const first = `${m[1]}-${m[2]}-01`;
  const nextFirst = mo === 12 ? `${y + 1}-01-01` : `${m[1]}-${String(mo + 1).padStart(2, '0')}-01`;
  return { from: startOfBusinessDayKey(first, tz), to: startOfBusinessDayKey(nextFirst, tz), first_day: first, last_day: addDaysToKey(nextFirst, -1) };
}

/** The calendar year of `year` (YYYY) or of a day key. */
export function businessYearRange(year: string, tz = BUSINESS_TZ): BusinessRange {
  const y = Number(/^(\d{4})/.exec(year)?.[1]);
  if (!y) throw new Error(`Invalid year: ${year}`);
  return {
    from: startOfBusinessDayKey(`${y}-01-01`, tz),
    to: startOfBusinessDayKey(`${y + 1}-01-01`, tz),
    first_day: `${y}-01-01`,
    last_day: `${y}-12-31`,
  };
}

export type ReportPeriodKind = 'day' | 'week' | 'month' | 'year';

/** The [from, to) range of a report period containing the day `key`. */
export function businessPeriodRange(period: ReportPeriodKind, key: string, tz = BUSINESS_TZ): BusinessRange {
  switch (period) {
    case 'day': return businessDayRange(key, tz);
    case 'week': return businessWeekRange(key, tz);
    case 'month': return businessMonthRange(key, tz);
    case 'year': return businessYearRange(key, tz);
  }
}

/** Every day key of a range, oldest first. */
export function dayKeysOf(range: BusinessRange): string[] {
  const keys: string[] = [];
  for (let k = range.first_day; k <= range.last_day; k = addDaysToKey(k, 1)) keys.push(k);
  return keys;
}
