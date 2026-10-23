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
