import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SettlementsService } from './settlements.service';
import { createFakeSupabase, has } from '../test-utils/fake-supabase';

const ACCOUNT = { method: 'mobile_money', operator: 'M-Pesa', number: '0990000000', holder_name: 'Jean' };

describe('SettlementsService.createSettlement', () => {
  it('requires a payout account and never creates anything without one', async () => {
    const fake = createFakeSupabase((q) => (q.target === 'merchants' ? { data: { settlement_account: null } } : undefined));
    await expect(new SettlementsService(fake.service).createSettlement('m1')).rejects.toBeInstanceOf(BadRequestException);
    expect(fake.queries.some((q) => q.target.startsWith('rpc:'))).toBe(false);
  });

  it('settles through the atomic database function with the payout account snapshot', async () => {
    const fake = createFakeSupabase((q) => {
      if (q.target === 'merchants') return { data: { settlement_account: ACCOUNT } };
      if (q.target === 'rpc:create_merchant_settlements') return { data: [{ reference: 'STL-1', transaction_count: 2, net_cents: 100, currency: 'CDF' }] };
      return undefined;
    });
    const result = await new SettlementsService(fake.service).createSettlement('m1');
    expect(result).toHaveLength(1);
    const rpc = fake.queries.find((q) => q.target === 'rpc:create_merchant_settlements')!;
    expect(rpc.calls[0].args[0]).toEqual({ p_merchant_id: 'm1', p_payout_account: ACCOUNT });
  });

  it('says so when there is nothing left to settle (e.g. the second tap of a double tap)', async () => {
    const fake = createFakeSupabase((q) => {
      if (q.target === 'merchants') return { data: { settlement_account: ACCOUNT } };
      if (q.target === 'rpc:create_merchant_settlements') return { data: [] };
      return undefined;
    });
    await expect(new SettlementsService(fake.service).createSettlement('m1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SettlementsService.getMerchantBalance', () => {
  it('deducts completed refunds and skips transactions with a refund in flight', async () => {
    const fake = createFakeSupabase((q) => {
      if (q.target === 'transactions') {
        return {
          data: [
            { net_cents: 1000, currency: 'CDF', refunds: [] },
            { net_cents: 3000, currency: 'CDF', refunds: [{ amount_cents: 500, status: 'COMPLETED' }, { amount_cents: 100, status: 'FAILED' }] },
            { net_cents: 800, currency: 'CDF', refunds: [{ amount_cents: 100, status: 'PENDING' }] },
            { net_cents: 200, currency: 'USD', refunds: [{ amount_cents: 999, status: 'COMPLETED' }] },
          ],
        };
      }
      return { data: [] };
    });
    const balance = await new SettlementsService(fake.service).getMerchantBalance('m1');
    expect(balance.available).toEqual({ CDF: 3500, USD: 0 });
  });
});

describe('SettlementsService.updateSettlementStatus', () => {
  it('only moves forward from the expected previous status', async () => {
    const fake = createFakeSupabase(() => ({ data: { id: 's1', status: 'COMPLETED' } }));
    await new SettlementsService(fake.service).updateSettlementStatus('s1', 'COMPLETED');
    const update = fake.queries.find((q) => q.target === 'settlements')!;
    expect(has(update, 'eq', 'status', 'PROCESSING')).toBe(true);
  });

  it('refuses a move that does not apply (e.g. reopening a paid settlement)', async () => {
    const fake = createFakeSupabase(() => ({ data: null, error: { message: 'no rows' } }));
    await expect(new SettlementsService(fake.service).updateSettlementStatus('s1', 'PROCESSING')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unknown statuses', async () => {
    const fake = createFakeSupabase(() => undefined);
    await expect(new SettlementsService(fake.service).updateSettlementStatus('s1', 'PENDING')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fails a settlement through fail_settlement so its transactions are released', async () => {
    const fake = createFakeSupabase((q) => (q.target === 'rpc:fail_settlement' ? { data: { id: 's1', status: 'FAILED' } } : undefined));
    await new SettlementsService(fake.service).updateSettlementStatus('s1', 'FAILED', 'numéro invalide');
    const rpc = fake.queries.find((q) => q.target === 'rpc:fail_settlement')!;
    expect(rpc.calls[0].args[0]).toEqual({ p_settlement_id: 's1', p_notes: 'numéro invalide' });
  });
});
