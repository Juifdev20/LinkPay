import { BadRequestException } from '@nestjs/common';
import { WalletLimitsService } from './wallet-limits.service';
import { createFakeSupabase, has, RecordedQuery } from '../test-utils/fake-supabase';

describe('daily / monthly caps count only the same currency', () => {
  function setup(rows: { amount_cents: number; currency: string }[]) {
    const fake = createFakeSupabase((q: RecordedQuery) => {
      if (q.target !== 'ledger_entries') return { data: null };
      const cur = q.calls.find((c) => c.method === 'eq' && c.args[0] === 'currency')?.args[1];
      return { data: rows.filter((r) => !cur || r.currency === cur) };
    });
    return { service: new WalletLimitsService(fake.service as any), fake };
  }
  const RULE = { currency: 'CDF', daily_max_cents: 1_000_000, monthly_max_cents: null as any };

  it('USD spent today does not count against the CDF cap', async () => {
    const { service, fake } = setup([{ amount_cents: 900_000, currency: 'USD' }, { amount_cents: 100_000, currency: 'CDF' }]);
    await expect(service.assertWithinLimits('w1', 'TRANSFER' as any, 500_000, RULE)).resolves.toBeUndefined();
    expect(fake.queries.some((q) => has(q, 'eq', 'currency', 'CDF'))).toBe(true);
  });

  it('CDF spent today still counts', async () => {
    const { service } = setup([{ amount_cents: 700_000, currency: 'CDF' }]);
    await expect(service.assertWithinLimits('w1', 'TRANSFER' as any, 500_000, RULE)).rejects.toBeInstanceOf(BadRequestException);
  });
});
