import { OrgTreasuryService } from './org-treasury.service';
import { treasuryPasswordIssue, treasuryPasswordScore } from './treasury-password';

/** A Supabase stub: every table answers with the rows given, whatever the filters. */
function fakeDb(tables: Record<string, any[]>) {
  const chain = (rows: any[]) => {
    const q: any = {
      select: () => q, eq: () => q, in: () => q, gte: () => q, range: () => q, single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: any) => resolve({ data: rows, error: null }),
    };
    return q;
  };
  return { getClient: () => ({ from: (t: string) => chain(tables[t] || []) }) } as any;
}

const config = { get: (k: string) => (k === 'JWT_SECRET' ? 'j'.repeat(48) : undefined) } as any;

describe('treasury password rules', () => {
  it('refuses short or weak passwords and accepts a medium one', () => {
    expect(treasuryPasswordIssue('abc123')).toMatch(/au moins 8/);
    expect(treasuryPasswordIssue('abcdefgh')).toMatch(/trop faible/);
    expect(treasuryPasswordIssue('Abcdefgh')).toBeNull();
    expect(treasuryPasswordScore('Abcdefgh12!x')).toBe(4);
  });
});

describe('OrgTreasuryService', () => {
  it('only accepts its own token, for the same organization and user', () => {
    const svc = new OrgTreasuryService(fakeDb({}), config);
    const token = (svc as any).sign('org1', 'user1', Date.now() + 60_000);
    expect(() => svc.assertToken('org1', 'user1', token)).not.toThrow();
    expect(() => svc.assertToken('org2', 'user1', token)).toThrow('TREASURY_LOCKED');
    expect(() => svc.assertToken('org1', 'user2', token)).toThrow('TREASURY_LOCKED');
    expect(() => svc.assertToken('org1', 'user1', undefined)).toThrow('TREASURY_LOCKED');
    expect(() => svc.assertToken('org1', 'user1', token + 'x')).toThrow('TREASURY_LOCKED');
    expect(() => svc.assertToken('org1', 'user1', (svc as any).sign('org1', 'user1', Date.now() - 1))).toThrow('TREASURY_LOCKED');
  });

  it('works out collected, spent and real cash per station, with unassigned expenses on their own line', async () => {
    const svc = new OrgTreasuryService(fakeDb({
      merchants: [{ id: 'm1', name: 'Kasindi' }, { id: 'm2', name: 'Goma' }],
      pos_tickets: [{ merchant_id: 'm1', total_cents: 1000, currency: 'USD' }],
      sales: [{ merchant_id: 'm1', total_cents: 500, currency: 'USD' }, { merchant_id: 'm2', total_cents: 90000, currency: 'CDF' }],
      organization_expenses: [
        { merchant_id: 'm1', amount_cents: 300, currency: 'USD' },
        { merchant_id: null, amount_cents: 100, currency: 'USD' },
      ],
    }), config);
    const { stations, totals } = await svc.overview('org1');
    expect(stations.find((s) => s.merchant_id === 'm1')!.net).toEqual({ CDF: 0, USD: 1200 });
    expect(stations.find((s) => s.merchant_id === 'm2')!.net).toEqual({ CDF: 90000, USD: 0 });
    expect(stations.find((s) => s.merchant_id === null)!.net).toEqual({ CDF: 0, USD: -100 });
    expect(totals).toEqual({ collected: { CDF: 90000, USD: 1500 }, expenses: { CDF: 0, USD: 400 }, net: { CDF: 90000, USD: 1100 } });
  });
});
