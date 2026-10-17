import { PaymentsService } from './payments.service';
import { PendingPaymentsReconciliationService } from './pending-payments-reconciliation.service';
import { createFakeSupabase, has, RecordedQuery } from '../test-utils/fake-supabase';

function setup(rows: { intents?: any[]; topups?: any[]; pros?: any[] }, live: Record<string, any>) {
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'payment_intents') return { data: rows.intents ?? [] };
    if (q.target === 'wallet_topups') return { data: rows.topups ?? [] };
    if (q.target === 'expense_pro_payments') return { data: rows.pros ?? [] };
    return { data: null };
  });
  const adapter = { getTransactionStatus: jest.fn(async (id: string) => { const r = live[id]; if (r instanceof Error) throw r; return r ?? { status: 'PENDING', amount_cents: 0, currency: 'CDF' }; }) };
  const factory = { get: jest.fn(() => adapter) };
  const service: any = new PaymentsService(fake.service, factory as any, {} as any, {} as any, {} as any, { create: jest.fn() } as any, {} as any, { get: () => undefined } as any, {} as any, {} as any, { log: jest.fn() } as any, {} as any, {} as any, {} as any, { alert: jest.fn() } as any);
  const success = jest.spyOn(service, 'handleSuccessfulPayment').mockResolvedValue({ id: 'tx' });
  const failed = jest.spyOn(service, 'handleFailedPayment').mockResolvedValue(undefined);
  const topup = jest.spyOn(service, 'tryHandleTopupWebhook').mockResolvedValue(true);
  const pro = jest.spyOn(service, 'tryHandleExpenseProWebhook').mockResolvedValue(true);
  return { service: service as PaymentsService, fake, adapter, factory, success, failed, topup, pro };
}

describe('PaymentsService.reconcilePending', () => {
  it('settles a payment the callback never settled — with the amount the provider confirms', async () => {
    const intent = { id: 'i1', psp_intent_id: 'REF-1', amount_cents: 500000 };
    const { service, success, failed, topup, pro } = setup({ intents: [intent], topups: [{ psp_intent_id: 'TOPUP-1' }], pros: [{ psp_intent_id: 'PRO-1' }] }, {
      'REF-1': { status: 'SUCCESS', amount_cents: 500000, currency: 'CDF' },
      'TOPUP-1': { status: 'SUCCESS', amount_cents: 20000, currency: 'CDF' },
      'PRO-1': { status: 'FAILED', amount_cents: 0, currency: 'CDF' },
    });
    expect(await service.reconcilePending('flexpaie')).toEqual({ checked: 3, settled: 3 });
    expect(success).toHaveBeenCalledWith(intent, { psp_intent_id: 'REF-1', amount_cents: 500000 });
    expect(failed).not.toHaveBeenCalled();
    expect(topup).toHaveBeenCalledWith('TOPUP-1', 'SUCCESS', 20000);
    expect(pro).toHaveBeenCalledWith('PRO-1', 'FAILED');
  });

  it('a payment the provider says failed is failed; one still waiting is left alone', async () => {
    const { service, success, failed } = setup({ intents: [{ id: 'i1', psp_intent_id: 'A' }, { id: 'i2', psp_intent_id: 'B' }] }, { A: { status: 'FAILED', amount_cents: 0, currency: 'CDF' }, B: { status: 'PENDING', amount_cents: 0, currency: 'CDF' } });
    expect(await service.reconcilePending('flexpaie')).toEqual({ checked: 2, settled: 1 });
    expect(failed).toHaveBeenCalledTimes(1);
    expect(success).not.toHaveBeenCalled();
  });

  it('a provider that cannot be reached for one payment does not stop the others', async () => {
    const { service, success } = setup({ intents: [{ id: 'i1', psp_intent_id: 'A' }, { id: 'i2', psp_intent_id: 'B' }] }, { A: new Error('boom'), B: { status: 'SUCCESS', amount_cents: 1, currency: 'CDF' } });
    expect(await service.reconcilePending('flexpaie')).toEqual({ checked: 2, settled: 1 });
    expect(success).toHaveBeenCalledTimes(1);
  });

  it('one payment that cannot be settled does not stop the others, and is not counted', async () => {
    const { service, success } = setup({ intents: [{ id: 'i1', psp_intent_id: 'A' }, { id: 'i2', psp_intent_id: 'B' }] }, { A: { status: 'SUCCESS', amount_cents: 1, currency: 'CDF' }, B: { status: 'SUCCESS', amount_cents: 1, currency: 'CDF' } });
    success.mockRejectedValueOnce(new Error('db down'));
    expect(await service.reconcilePending('flexpaie')).toEqual({ checked: 2, settled: 1 });
  });

  it('only looks at this provider\'s payments that are waiting, older than 45 s and not older than 3 days', async () => {
    const { service, fake } = setup({ intents: [], topups: [], pros: [] }, {});
    await service.reconcilePending('flexpaie');
    for (const table of ['payment_intents', 'wallet_topups', 'expense_pro_payments']) {
      const q = fake.queries.find((x) => x.target === table)!;
      expect(has(q, 'eq', 'psp_provider', 'flexpaie')).toBe(true);
      expect(has(q, 'eq', 'status', 'PENDING')).toBe(true);
      const lt = q.calls.find((c) => c.method === 'lt')!.args[1];
      const gt = q.calls.find((c) => c.method === 'gt')!.args[1];
      expect(Date.now() - new Date(lt).getTime()).toBeGreaterThanOrEqual(44_000);
      expect(Date.now() - new Date(gt).getTime()).toBeLessThan(73 * 3_600_000);
    }
  });

  it('does nothing for the mock provider and for wallet payments', async () => {
    const { service, fake, factory } = setup({}, {});
    for (const p of ['mock', 'wallet', '']) expect(await service.reconcilePending(p)).toEqual({ checked: 0, settled: 0 });
    expect(fake.queries).toHaveLength(0);
    expect(factory.get).not.toHaveBeenCalled();
  });
});

describe('PendingPaymentsReconciliationService (every minute)', () => {
  const make = (provider: string, lock?: any) => {
    const payments = { reconcilePending: jest.fn(async () => ({ checked: 2, settled: 1 })) };
    const svc = new PendingPaymentsReconciliationService(payments as any, { get: (_k: string, d?: any) => provider ?? d } as any, lock);
    return { svc, payments };
  };
  it('reconciles the configured provider', async () => {
    const { svc, payments } = make('flexpaie');
    expect(await svc.run()).toEqual({ checked: 2, settled: 1 });
    expect(payments.reconcilePending).toHaveBeenCalledWith('flexpaie');
  });
  it('does nothing in mock mode, or when another instance holds the lock', async () => {
    expect((await make('mock').svc.run()).checked).toBe(0);
    const { svc, payments } = make('flexpaie', { acquire: jest.fn(async () => false) });
    expect((await svc.run()).checked).toBe(0);
    expect(payments.reconcilePending).not.toHaveBeenCalled();
  });
  it('never lets a failure escape the schedule', async () => {
    const { svc, payments } = make('flexpaie');
    payments.reconcilePending.mockRejectedValue(new Error('db down'));
    await expect(svc.run()).resolves.toEqual({ checked: 0, settled: 0 });
  });
});
