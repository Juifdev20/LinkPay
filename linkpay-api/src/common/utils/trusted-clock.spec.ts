import { offsetFromDateHeader } from './trusted-clock';

describe('trusted clock', () => {
  it('measures how far the local clock is ahead of the server (negative offset)', () => {
    const server = 'Wed, 21 Oct 2026 19:47:03 GMT';
    const localAhead = Date.parse('2026-10-22T05:43:39Z'); // a PC ~10 h ahead
    expect(offsetFromDateHeader(server, localAhead)).toBe(Date.parse(server) - localAhead);
    expect(offsetFromDateHeader(server, localAhead)!).toBeLessThan(0);
  });

  it('is 0-ish when the clocks agree', () => {
    const server = 'Wed, 21 Oct 2026 19:47:03 GMT';
    expect(offsetFromDateHeader(server, Date.parse(server))).toBe(0);
  });

  it('returns null when the header is missing or unreadable', () => {
    expect(offsetFromDateHeader(undefined, Date.now())).toBeNull();
    expect(offsetFromDateHeader('not a date', Date.now())).toBeNull();
  });
});
