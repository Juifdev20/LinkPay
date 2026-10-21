import { WithdrawalPayoutService } from './withdrawal-payout.service';
import { NotFoundException } from '@nestjs/common';
import { PayoutNotSentError, PayoutRetryLaterError } from '../payments/psp/psp.adapter';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

const W = { id: 'w1', wallet_id: 'wal1', amount_cents: 200000, fee_cents: 5000, currency: 'CDF', channel: 'mobile_money', destination: { operator: 'mpesa', phone: '+243900000000' }, psp_provider: 'mock', status: 'PENDING', created_at: new Date().toISOString() };

type Rpcs = Record<string, any>;
function setup(adapter: any, rpcs: Rpcs = {}, openWithdrawals: any[] = [], extra: { alerts?: any; config?: Record<string, any>; row?: any } = {}) {
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target.startsWith('rpc:')) {
      const fn = q.target.slice(4);
      return fn in rpcs ? { data: rpcs[fn] } : { data: null };
    }
    if (q.target === 'wallets') return { data: { user_id: 'user-1' } };
    if (q.target === 'withdrawals') {
      if (q.calls.some((c) => c.method === 'maybeSingle')) return { data: extra.row ?? null };
      return { data: q.calls.some((c) => c.method === 'order') ? openWithdrawals : { ...W, status: 'PROCESSING' } };
    }
    return undefined;
  });
  const notifications = { create: jest.fn(async () => undefined) };
  const config = extra.config ? ({ get: (k: string, d?: any) => extra.config![k] ?? d } as any) : undefined;
  const service = new WithdrawalPayoutService(fake.service, { get: () => adapter } as any, notifications as any, undefined, extra.alerts, config);
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

describe('automatic payouts (FlexPaie PayoutService)', () => {
  const old = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();
  const UUID = '11111111-1111-4111-8111-111111111111';

  it('the provider is posted the outcome at /webhooks/payouts/<provider> by default', async () => {
    const adapter = { provider: 'flexpaie', payout: jest.fn(async () => ({ psp_payout_id: 'p1', status: 'PENDING' })) };
    const { service } = setup(adapter, { mark_withdrawal_processing: { ...W, status: 'PROCESSING' } }, [], { config: { BACKEND_URL: 'https://api.example/' } });
    await service.dispatch(W);
    expect(adapter.payout).toHaveBeenCalledWith(expect.objectContaining({ callback_url: 'https://api.example/api/v1/webhooks/payouts/flexpaie' }));
  });

  it('"busy, try later": NOT refunded, stays open for the next round', async () => {
    const adapter = { payout: async () => { throw new PayoutRetryLaterError('busy'); } };
    const { service, called } = setup(adapter);
    const r = await service.dispatch(W);
    expect(r).toEqual({ withdrawal: W });
    expect(called()).toEqual([]);
  });

  it('a refusal caused on our side (FlexPaie balance): refunded AND the administrators alerted', async () => {
    const alerts = { alert: jest.fn(async () => undefined) };
    const adapter = { provider: 'flexpaie', payout: async () => { throw new PayoutNotSentError('Indisponible.', 'Solde FlexPaie insuffisant.'); } };
    const { service, called } = setup(adapter, { fail_withdrawal: { ...W, status: 'REVERSED' } }, [], { alerts });
    const r = await service.dispatch(W);
    expect(r.rejectedReason).toBe('Indisponible.');
    expect(called()).toEqual(['fail_withdrawal']);
    await new Promise((res) => setImmediate(res));
    expect(alerts.alert).toHaveBeenCalledWith(expect.objectContaining({ severity: 'critical', audience: 'admins', body: expect.stringContaining('Solde FlexPaie insuffisant.') }));
  });

  it('a bank withdrawal stays with the admin even when payouts are automatic', async () => {
    const adapter = { supportsPayout: true, supportsPayoutChannel: (c: string) => c === 'mobile_money', payout: jest.fn(), getPayoutStatus: jest.fn() };
    const { service } = setup(adapter, {}, [{ ...W, channel: 'bank', created_at: old(30) }]);
    expect((await service.dispatch({ ...W, channel: 'bank' })).manual).toBe(true);
    await service.reconcile();
    expect(adapter.payout).not.toHaveBeenCalled();
    expect(adapter.getPayoutStatus).not.toHaveBeenCalled();
  });

  it('reconcile sends what was never sent (asked during the manual period, or refused as busy)', async () => {
    const adapter = { getPayoutStatus: jest.fn(async () => ({ status: 'NOT_SENT' })), payout: jest.fn(async () => ({ psp_payout_id: 'O1', status: 'PENDING' })) };
    const { service, called } = setup(adapter, { mark_withdrawal_processing: { ...W, status: 'PROCESSING' } }, [{ ...W, status: 'PENDING', created_at: old(600) }]);
    await expect(service.reconcile()).resolves.toBe(1);
    expect(adapter.payout).toHaveBeenCalledTimes(1);
    expect(called()).toEqual(['mark_withdrawal_processing']);
  });

  it('reconcile hands the stored provider id to the status check', async () => {
    const adapter = { getPayoutStatus: jest.fn(async () => ({ status: 'PENDING' })) };
    const { service } = setup(adapter, {}, [{ ...W, status: 'PROCESSING', psp_reference: 'O1', created_at: old(5) }]);
    await service.reconcile();
    expect(adapter.getPayoutStatus).toHaveBeenCalledWith('w1', { psp_reference: 'O1' });
  });

  describe('callback', () => {
    it('unknown provider, or one without payout callbacks: 404', async () => {
      const none = new WithdrawalPayoutService({} as any, { get: () => { throw new Error('unknown'); } } as any, {} as any);
      await expect(none.handleCallback('nope', Buffer.from('{}'))).rejects.toBeInstanceOf(NotFoundException);
      const { service } = setup({ provider: 'mock' });
      await expect(service.handleCallback('mock', Buffer.from('{}'))).rejects.toBeInstanceOf(NotFoundException);
    });

    it('settles the withdrawal it names from the provider\'s own status, not from the callback', async () => {
      const adapter = { provider: 'flexpaie', acceptPayoutCallback: jest.fn(async () => UUID), getPayoutStatus: jest.fn(async () => ({ status: 'SUCCESS', psp_payout_id: 'O1' })) };
      const { service, called } = setup(adapter, { finish_withdrawal: { ...W, status: 'SUCCESS' } }, [], { row: { ...W, id: UUID, psp_provider: 'flexpaie', status: 'PROCESSING' } });
      await expect(service.handleCallback('flexpaie', Buffer.from('{}'))).resolves.toEqual({ received: true });
      expect(adapter.getPayoutStatus).toHaveBeenCalledWith(UUID, { psp_reference: null });
      expect(called()).toEqual(['finish_withdrawal']);
    });

    it('ignored when the adapter does not recognise it', async () => {
      const adapter = { provider: 'flexpaie', acceptPayoutCallback: async () => null, getPayoutStatus: jest.fn() };
      const { service, called } = setup(adapter);
      await expect(service.handleCallback('flexpaie', Buffer.from('{}'))).resolves.toEqual({ received: true });
      expect(adapter.getPayoutStatus).not.toHaveBeenCalled();
      expect(called()).toEqual([]);
    });

    it('refunded for lack of news, then reported as paid: critical alert (paid twice)', async () => {
      const alerts = { alert: jest.fn(async () => undefined) };
      const adapter = { provider: 'flexpaie', acceptPayoutCallback: async () => UUID, getPayoutStatus: async () => ({ status: 'SUCCESS', psp_payout_id: 'O1' }) };
      const { service, called } = setup(adapter, {}, [], { alerts, row: { ...W, id: UUID, psp_provider: 'flexpaie', status: 'REVERSED' } });
      await service.handleCallback('flexpaie', Buffer.from('{}'));
      await new Promise((res) => setImmediate(res));
      expect(called()).toEqual([]);
      expect(alerts.alert).toHaveBeenCalledWith(expect.objectContaining({ severity: 'critical', title: 'Retrait payé ET remboursé' }));
    });
  });
});

describe('automatic payouts switched OFF while withdrawals are with the provider', () => {
  const old = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();

  it('one already handed to the provider keeps being followed (never left to an admin), but nothing new is sent', async () => {
    const statuses: Record<string, any> = { sent: { status: 'SUCCESS', psp_payout_id: 'O1' }, never: { status: 'NOT_SENT' } };
    const adapter = {
      supportsPayout: false,
      payoutsInFlight: async (ids: string[]) => new Set(ids.filter((id) => id === 'sent')),
      getPayoutStatus: jest.fn(async (id: string) => statuses[id]),
      payout: jest.fn(),
    };
    const open = [{ ...W, id: 'sent', status: 'PROCESSING', created_at: old(5) }, { ...W, id: 'never', status: 'PENDING', created_at: old(5) }];
    const { service, called } = setup(adapter, { finish_withdrawal: { ...W, status: 'SUCCESS' } }, open);
    await expect(service.reconcile()).resolves.toBe(1);
    expect(called()).toEqual(['finish_withdrawal']);
    expect(adapter.getPayoutStatus).toHaveBeenCalledTimes(1); // "never" is manual: not even asked
    expect(adapter.payout).not.toHaveBeenCalled();
  });
});
