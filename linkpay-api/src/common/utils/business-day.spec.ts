import { businessDayKey, startOfBusinessDay, lastBusinessDays } from './business-day';

describe('business day (Africa/Lubumbashi, UTC+2)', () => {
  it('cuts the day at local midnight, not UTC midnight', () => {
    // 23:30 UTC on the 21st is already 01:30 on the 22nd in Lubumbashi.
    expect(businessDayKey(new Date('2026-10-21T23:30:00Z'))).toBe('2026-10-22');
    expect(businessDayKey(new Date('2026-10-21T21:59:59Z'))).toBe('2026-10-21');
  });

  it('startOfBusinessDay is 22:00 UTC the evening before', () => {
    expect(startOfBusinessDay(new Date('2026-10-22T03:35:45Z')).toISOString()).toBe('2026-10-21T22:00:00.000Z');
    expect(startOfBusinessDay(new Date('2026-10-21T21:59:59Z')).toISOString()).toBe('2026-10-20T22:00:00.000Z');
  });

  it('lists the last n days, today last', () => {
    expect(lastBusinessDays(3, new Date('2026-10-22T03:35:45Z'))).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
  });
});
