import { MerchantWalletCreditService } from './merchant-wallet-credit.service';
import { createFakeSupabase, has, RecordedQuery } from '../test-utils/fake-supabase';

describe('MerchantWalletCreditService', () => {
  it('credits through the idempotent database function', async () => {
    const fake = createFakeSupabase(() => ({ data: 955000 }));
    await expect(new MerchantWalletCreditService(fake.service).credit('tx1')).resolves.toBe(true);
    expect(fake.queries[0].target).toBe('rpc:credit_merchant_wallet');
    expect(fake.queries[0].calls[0].args[0]).toEqual({ p_transaction_id: 'tx1' });
  });

  it('never throws when the credit fails — it reports false so the payment itself still succeeds', async () => {
    const fake = createFakeSupabase(() => ({ data: null, error: { message: 'boom' } }));
    await expect(new MerchantWalletCreditService(fake.service).credit('tx1')).resolves.toBe(false);
  });

  it('retry job credits each uncredited successful transaction and counts the ones that worked', async () => {
    const fake = createFakeSupabase((q: RecordedQuery) => {
      if (q.target === 'transactions') return { data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
      if (q.target === 'rpc:credit_merchant_wallet') {
        return q.calls[0].args[0].p_transaction_id === 'b' ? { error: { message: 'no wallet' } } : { data: 1 };
      }
      return undefined;
    });
    const service = new MerchantWalletCreditService(fake.service);
    await expect(service.retryUncredited()).resolves.toBe(2);

    const select = fake.queries.find((q) => q.target === 'transactions')!;
    expect(has(select, 'in', 'status', ['SUCCESS', 'PARTIALLY_REFUNDED'])).toBe(true);
    expect(has(select, 'is', 'wallet_credited_at', null)).toBe(true);
    expect(fake.queries.filter((q) => q.target === 'rpc:credit_merchant_wallet')).toHaveLength(3);
  });

  it('does nothing when there is nothing to retry', async () => {
    const fake = createFakeSupabase(() => ({ data: [] }));
    await expect(new MerchantWalletCreditService(fake.service).retryUncredited()).resolves.toBe(0);
  });
});
