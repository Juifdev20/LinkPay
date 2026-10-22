import { TreasuryService } from './treasury.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

const ROW = {
  currency: 'CDF', owed_wallets: 900000, owed_savings: 50000, pending_withdrawals: 30000, uncredited_payments: 20000, negative_wallets: 0,
  subscriptions: 300000, commissions: 45000, withdrawal_fees: 6000, transfer_fees: 0, pro_payments: 10000,
};

function setup(notes: any[]) {
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'rpc:treasury_overview') return { data: [ROW, { ...ROW, currency: 'USD', owed_wallets: 0, owed_savings: 0, pending_withdrawals: 0, uncredited_payments: 0 }] };
    if (q.target === 'treasury_balances') return { data: notes };
    return { data: null };
  });
  const audit = { log: jest.fn(async () => undefined) };
  return { service: new TreasuryService(fake.service, audit as any), fake, audit };
}

describe('Trésorerie', () => {
  it('available = FlexPaie balance typed in − everything owed to the users', async () => {
    const { service } = setup([{ currency: 'CDF', amount_cents: 1400000, noted_at: '2026-10-22T10:00:00Z' }]);
    const cdf = (await service.overview()).currencies.find((c) => c.currency === 'CDF')!;
    expect(cdf.owed.total).toBe(1000000); // 900 000 + 50 000 + 30 000 + 20 000
    expect(cdf.available).toBe(400000);
    expect(cdf.earned.total).toBe(361000);
  });

  it('never shows an amount as available while the FlexPaie balance was never typed in', async () => {
    const { service } = setup([]);
    const usd = (await service.overview()).currencies.find((c) => c.currency === 'USD')!;
    expect(usd.available).toBeNull();
    expect(usd.flexpaie_balance).toBeNull();
  });

  it('a FlexPaie balance lower than what is owed shows a negative amount (never hidden)', async () => {
    const { service } = setup([{ currency: 'CDF', amount_cents: 800000, noted_at: '2026-10-22T10:00:00Z' }]);
    expect((await service.overview()).currencies.find((c) => c.currency === 'CDF')!.available).toBe(-200000);
  });

  it('typing a balance is journaled; a wrong currency or amount is refused', async () => {
    const { service, audit } = setup([]);
    await service.noteFlexpaieBalance('admin-1', 'CDF', 1400000, 'relevé du 22/10');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'TREASURY_FLEXPAIE_BALANCE_NOTED' }));
    await expect(service.noteFlexpaieBalance('admin-1', 'EUR', 1, '')).rejects.toThrow();
    await expect(service.noteFlexpaieBalance('admin-1', 'CDF', -5, '')).rejects.toThrow();
  });
});
