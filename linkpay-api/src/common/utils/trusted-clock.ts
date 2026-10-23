/**
 * The host's own clock is not always right (a PC with a wrong timezone or time, a drifting VM), and
 * everything dated by the server — a sale's `paid_at`, "today" on the dashboards — follows it. The
 * database's timestamps (`created_at`…) come from the cloud's clock, so the two then disagree by hours.
 * We measure the gap once against the `Date` header of the database's own HTTP responses and correct
 * `Date.now()` by it. If the measure fails, the local clock is used as is.
 */
import { Logger } from '@nestjs/common';

const logger = new Logger('TrustedClock');
let offsetMs = 0;

/** serverDate − localNow, from an HTTP `Date` header; null if it can't be read. */
export function offsetFromDateHeader(header: string | null | undefined, localNowMs: number): number | null {
  if (!header) return null;
  const server = Date.parse(header);
  return Number.isNaN(server) ? null : server - localNowMs;
}

/** Now, by the cloud's clock. Synchronous: it uses the last measured gap. */
export function trustedNow(): Date {
  return new Date(Date.now() + offsetMs);
}

export function currentClockOffsetMs(): number {
  return offsetMs;
}

/** Measures the gap against `${baseUrl}` (the database's REST host). Never throws. */
export async function syncTrustedClock(baseUrl: string | undefined, apiKey?: string): Promise<void> {
  if (!baseUrl) return;
  try {
    const before = Date.now();
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/rest/v1/`, {
      method: 'HEAD',
      headers: apiKey ? { apikey: apiKey } : {},
      signal: AbortSignal.timeout(3000),
    });
    const after = Date.now();
    // The server stamped the response somewhere between the two local readings: take the middle.
    const measured = offsetFromDateHeader(res.headers.get('date'), Math.round((before + after) / 2));
    if (measured === null) return;
    // The header has 1 s resolution: ignore a gap smaller than that rather than "correct" noise.
    const next = Math.abs(measured) < 2000 ? 0 : measured;
    if (Math.abs(next - offsetMs) > 2000) {
      logger.warn(next === 0 ? 'Server clock agrees with the cloud clock again' : `Server clock is off by ${Math.round(next / 60000)} min vs the cloud clock — dating with the cloud clock`);
    }
    offsetMs = next;
  } catch {
    /* keep the previous offset (0 at first): the local clock is used */
  }
}

/** Measures now, then every `everyMs`. The timer never keeps the process alive. */
export async function startTrustedClock(baseUrl: string | undefined, apiKey?: string, everyMs = 10 * 60 * 1000): Promise<void> {
  await syncTrustedClock(baseUrl, apiKey);
  setInterval(() => void syncTrustedClock(baseUrl, apiKey), everyMs).unref();
}
