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

describe('business calendar ranges', () => {
  const { addDaysToKey, businessDayRange, businessWeekRange, businessMonthRange, businessYearRange, dayKeysOf } = require('./business-day');

  it('adds days across month and year ends', () => {
    expect(addDaysToKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToKey('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('a day starts at 22:00 UTC the evening before (UTC+2)', () => {
    const r = businessDayRange('2026-10-22');
    expect(r.from.toISOString()).toBe('2026-10-21T22:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-10-22T22:00:00.000Z');
  });

  it('weeks run Monday to Sunday', () => {
    const r = businessWeekRange('2026-10-22'); // a Thursday
    expect(r.first_day).toBe('2026-10-19');
    expect(r.last_day).toBe('2026-10-25');
    expect(dayKeysOf(r)).toHaveLength(7);
  });

  it('months and years cover their whole calendar span', () => {
    const m = businessMonthRange('2026-02');
    expect(m.first_day).toBe('2026-02-01');
    expect(m.last_day).toBe('2026-02-28');
    expect(dayKeysOf(m)).toHaveLength(28);
    expect(businessMonthRange('2026-12').to.toISOString()).toBe('2026-12-31T22:00:00.000Z');
    expect(dayKeysOf(businessYearRange('2026'))).toHaveLength(365);
  });
});
