import { WalletsService } from './wallets.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

const rows = [
  { entry_type: 'TRANSFER_OUT', direction: 'debit', amount_cents: 3300000, reference: 'T1' },
  { entry_type: 'PAYMENT', direction: 'debit', amount_cents: 1485000, reference: 'P1' },
  { entry_type: 'WITHDRAWAL', direction: 'debit', amount_cents: 990000, reference: 'WITHDRAWAL-1' },
  { entry_type: 'WITHDRAWAL', direction: 'debit', amount_cents: 500000, reference: 'WITHDRAWAL-2' },
  { entry_type: 'ADJUSTMENT', direction: 'credit', amount_cents: 500000, reference: 'WITHDRAWAL-REVERSAL-2' },
  { entry_type: 'TOPUP', direction: 'credit', amount_cents: 9000000, reference: 'TOPUP-1' },
  { entry_type: 'ADJUSTMENT', direction: 'debit', amount_cents: 825000, reference: 'X' },
];

function setup() {
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'wallets') return { data: { id: 'w1', user_id: 'u1', status: 'ACTIVE' } };
    if (q.target === 'ledger_entries') return { data: rows };
    return { data: null };
  });
  const service = new WalletsService(fake.service, {} as any, {} as any, { get: (_k: string, d?: any) => d } as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  return { service, fake };
}

describe('Mes dépenses — what left the wallet, by category', () => {
  it('counts debits only, by category, and a failed (refunded) withdrawal does not count', async () => {
    const { service } = setup();
    const r = await service.getSpending('u1', 1, 'CDF');
    expect(r.total_cents).toBe(3300000 + 1485000 + 990000 + 825000);
    expect(r.categories.map((c) => [c.key, c.amount_cents])).toEqual([
      ['transfer', 3300000], ['merchant_payment', 1485000], ['withdrawal', 990000], ['other', 825000],
    ]);
    expect(r.categories[0].percent).toBe(50);
  });

  it('reads one currency, from the start of the month (or of 2 / 5 months earlier)', async () => {
    const { service, fake } = setup();
    await service.getSpending('u1', 3, 'USD');
    const q = fake.queries.find((x) => x.target === 'ledger_entries')!;
    expect(q.calls).toEqual(expect.arrayContaining([expect.objectContaining({ method: 'eq', args: ['currency', 'USD'] })]));
    const since = new Date(q.calls.find((c) => c.method === 'gte')!.args[1]);
    expect(since.getDate()).toBe(1);
    const expected = new Date(); expected.setDate(1); expected.setMonth(expected.getMonth() - 2);
    expect(since.getMonth()).toBe(expected.getMonth());
  });
});
