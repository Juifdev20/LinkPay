import { WithdrawalPayoutService } from './withdrawal-payout.service';
import { PayoutNotSentError } from '../payments/psp/psp.adapter';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

const W = { id: 'w1', wallet_id: 'wal1', amount_cents: 200000, fee_cents: 5000, currency: 'CDF', channel: 'mobile_money', destination: { operator: 'mpesa', phone: '+243900000000' }, psp_provider: 'mock', status: 'PENDING', created_at: new Date().toISOString() };

type Rpcs = Record<string, any>;
function setup(adapter: any, rpcs: Rpcs = {}, openWithdrawals: any[] = []) {
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target.startsWith('rpc:')) {
      const fn = q.target.slice(4);
      return fn in rpcs ? { data: rpcs[fn] } : { data: null };
    }
    if (q.target === 'wallets') return { data: { user_id: 'user-1' } };
    if (q.target === 'withdrawals') return { data: q.calls.some((c) => c.method === 'order') ? openWithdrawals : { ...W, status: 'PROCESSING' } };
    return undefined;
  });
  const notifications = { create: jest.fn(async () => undefined) };
  const service = new WithdrawalPayoutService(fake.service, { get: () => adapter } as any, notifications as any);
  const called = () => fake.queries.filter((q) => q.target.startsWith('rpc:')).map((q) => q.target.slice(4));
  return { service, fake, notifications, called };
}

describe('WithdrawalPayoutService.dispatch', () => {
  it('sends the payout with the withdrawal id as the provider reference', async () => {
    const adapter = { payout: jest.fn(async () => ({ psp_payout_id: 'p1', status: 'SUCCESS' })) };
    const { service } = setup(adapter, { finish_withdrawal: { ...W, status: 'SUCCESS' } });
    await service.dispatch(W, 'https://api/cb');
    expect(adapter.payout).toHaveBeenCalledWith({ reference: 'w1', amount_cents: 200000, currency: 'CDF', channel: 'mobile_money', destination: W.destination, callback_url: 'https://api/cb' });
  });

  it('confirmed success: marks it SUCCESS and tells the user', async () => {
    const adapter = { payout: async () => ({ psp_payout_id: 'p1', status: 'SUCCESS' }) };
    const { service, notifications, called } = setup(adapter, { finish_withdrawal: { ...W, status: 'SUCCESS' } });
    const r = await service.dispatch(W);
    expect(r.withdrawal.status).toBe('SUCCESS');
    expect(called()).toEqual(['finish_withdrawal']);
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'withdrawal_success', user_id: 'user-1' }));
  });

  it('accepted but not final: stays PROCESSING and is NOT reported as done', async () => {
    const adapter = { payout: async () => ({ psp_payout_id: 'p1', status: 'PENDING' }) };
    const { service, notifications, called } = setup(adapter, { mark_withdrawal_processing: { ...W, status: 'PROCESSING' } });
    const r = await service.dispatch(W);
    expect(r.withdrawal.status).toBe('PROCESSING');
    expect(called()).toEqual(['mark_withdrawal_processing']);
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('confirmed failure: refunds the wallet through fail_withdrawal and reports why', async () => {
    const adapter = { payout: async () => ({ psp_payout_id: 'p1', status: 'FAILED', failure_reason: 'Numéro invalide.' }) };
    const { service, notifications, called } = setup(adapter, { fail_withdrawal: { ...W, status: 'REVERSED', failure_reason: 'Numéro invalide.' } });
    const r = await service.dispatch(W);
    expect(r.rejectedReason).toBe('Numéro invalide.');
    expect(called()).toEqual(['fail_withdrawal']);
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'withdrawal_failed' }));
  });

  it('provider certainly did not send (unsupported): refunds', async () => {
    const adapter = { payout: async () => { throw new PayoutNotSentError('Retraits indisponibles.'); } };
    const { service, called } = setup(adapter, { fail_withdrawal: { ...W, status: 'REVERSED' } });
    const r = await service.dispatch(W);
    expect(r.rejectedReason).toBe('Retraits indisponibles.');
    expect(called()).toEqual(['fail_withdrawal']);
  });

  it('timeout / network error: NEVER refunds — the money may have left — and stays open', async () => {
    const adapter = { payout: async () => { throw new Error('ETIMEDOUT'); } };
    const { service, called } = setup(adapter);
    const r = await service.dispatch(W);
    expect(r.rejectedReason).toBeUndefined();
    expect(r.withdrawal).toBe(W);
    expect(called()).toEqual([]);
  });
});

describe('WithdrawalPayoutService.apply', () => {
  it('is idempotent: an already-settled withdrawal is not notified or refunded again', async () => {
    const { service, notifications } = setup({}, { fail_withdrawal: null });
    const r = await service.apply('w1', { status: 'FAILED', reason: 'x' });
    expect(r.status).toBe('PROCESSING'); // the current row, untouched
    expect(notifications.create).not.toHaveBeenCalled();
  });
});

describe('WithdrawalPayoutService.reconcile', () => {
  const old = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();

  it('settles open withdrawals from what the provider says', async () => {
    const statuses: Record<string, any> = {
      ok: { status: 'SUCCESS', psp_payout_id: 'p' },
      ko: { status: 'FAILED', failure_reason: 'refusé' },
      wait: { status: 'PENDING' },
    };
    const adapter = { getPayoutStatus: jest.fn(async (id: string) => statuses[id]) };
    const open = ['ok', 'ko', 'wait'].map((id) => ({ ...W, id, status: 'PROCESSING', created_at: old(5) }));
    const { service, called } = setup(adapter, { finish_withdrawal: { ...W, status: 'SUCCESS' }, fail_withdrawal: { ...W, status: 'REVERSED' } }, open);
    await expect(service.reconcile()).resolves.toBe(2);
    expect(called().sort()).toEqual(['fail_withdrawal', 'finish_withdrawal']);
  });

  it('provider has no trace and 10+ minutes passed since a PENDING one: it never left, so refund', async () => {
    const adapter = { getPayoutStatus: async () => ({ status: 'NOT_FOUND' }) };
    const { service, called } = setup(adapter, { fail_withdrawal: { ...W, status: 'REVERSED' } }, [{ ...W, status: 'PENDING', created_at: old(30) }]);
    await expect(service.reconcile()).resolves.toBe(1);
    expect(called()).toEqual(['fail_withdrawal']);
  });

  it('provider has no trace but it is recent: wait, it may just be a delay on their side', async () => {
    const adapter = { getPayoutStatus: async () => ({ status: 'NOT_FOUND' }) };
    const { service, called } = setup(adapter, {}, [{ ...W, status: 'PENDING', created_at: old(2) }]);
    await expect(service.reconcile()).resolves.toBe(0);
    expect(called()).toEqual([]);
  });

  it('accepted earlier (PROCESSING) but now unknown to the provider: never auto-refund, needs a human', async () => {
    const adapter = { getPayoutStatus: async () => ({ status: 'NOT_FOUND' }) };
    const { service, called } = setup(adapter, {}, [{ ...W, status: 'PROCESSING', created_at: old(60) }]);
    await expect(service.reconcile()).resolves.toBe(0);
    expect(called()).toEqual([]);
  });

  it('one failing withdrawal does not stop the others', async () => {
    const adapter = { getPayoutStatus: jest.fn(async (id: string) => { if (id === 'bad') throw new Error('boom'); return { status: 'SUCCESS' }; }) };
    const open = ['bad', 'good'].map((id) => ({ ...W, id, status: 'PROCESSING', created_at: old(5) }));
    const { service } = setup(adapter, { finish_withdrawal: { ...W, status: 'SUCCESS' } }, open);
    await expect(service.reconcile()).resolves.toBe(1);
  });
});
