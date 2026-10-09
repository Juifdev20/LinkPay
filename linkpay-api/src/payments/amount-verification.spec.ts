import { BadRequestException } from '@nestjs/common';
import { confirmedAmountMatches, isWholeCurrencyUnits } from './psp/amount-check';
import { PaymentsService } from './payments.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

describe('amount checks', () => {
  it('the provider must confirm exactly the amount we recorded (unknown amounts, as with the mock provider, cannot be compared)', () => {
    expect(confirmedAmountMatches(100000, 100000)).toBe(true);
    expect(confirmedAmountMatches(100000, 50000)).toBe(false);
    expect(confirmedAmountMatches(100000, 100100)).toBe(false);
    for (const unknown of [undefined, null, 0, NaN]) expect(confirmedAmountMatches(100000, unknown as any)).toBe(true);
  });

  it('only whole currency units can be billed by a provider that counts in units', () => {
    expect(isWholeCurrencyUnits(150000)).toBe(true);
    expect(isWholeCurrencyUnits(149)).toBe(false); // 1.49 USD would have been charged 1 and credited 1.49
    expect(isWholeCurrencyUnits(150050)).toBe(false);
    expect(isWholeCurrencyUnits(100.5)).toBe(false);
  });
});

describe('PaymentsService — a confirmed amount that differs credits nothing', () => {
  const INTENT = { id: 'i1', payment_request_id: 'pr1', amount_cents: 1000000, currency: 'CDF', client_id: 'c1', status: 'PENDING' };
  function setup() {
    const fake = createFakeSupabase((q: RecordedQuery) => {
      if (q.target === 'wallet_topups') return { data: { id: 't1', wallet_id: 'w1', amount_cents: 500000, currency: 'CDF', status: 'PENDING' } };
      return { data: null };
    });
    const alerts = { alert: jest.fn() };
    const credit = jest.fn();
    const service = new PaymentsService(
      fake.service, {} as any, {} as any, {} as any, {} as any, { create: jest.fn() } as any, {} as any, { get: () => undefined } as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, { credit } as any, alerts as any,
    );
    return { service: service as any, fake, alerts };
  }

  it('a payment: not claimed, nothing created, the admins are alerted', async () => {
    const { service, fake, alerts } = setup();
    expect(await service.handleSuccessfulPayment(INTENT, { psp_intent_id: 'p', amount_cents: 999999 })).toBeUndefined();
    expect(fake.queries.some((q) => q.target === 'payment_intents' && q.calls.some((c) => c.method === 'update'))).toBe(false);
    expect(alerts.alert).toHaveBeenCalledWith(expect.objectContaining({ severity: 'critical' }));
  });

  it('a wallet top-up: the wallet is not credited', async () => {
    const { service, fake, alerts } = setup();
    expect(await service.tryHandleTopupWebhook('psp1', 'SUCCESS', 49900)).toBe(true);
    expect(fake.queries.some((q) => q.target === 'rpc:complete_topup' || q.target === 'rpc:credit_wallet')).toBe(false);
    expect(alerts.alert).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('Montant') }));
  });

  it('a late FAILED never overwrites a top-up that already succeeded (only PENDING can fail)', async () => {
    const { service, fake } = setup();
    await service.tryHandleTopupWebhook('psp1', 'FAILED');
    const upd = fake.queries.find((q) => q.target === 'wallet_topups' && q.calls.some((c) => c.method === 'update'))!;
    expect(upd.calls.some((c) => c.method === 'eq' && c.args[0] === 'status' && c.args[1] === 'PENDING')).toBe(true);
  });
});

describe('CinetPay adapter', () => {
  it('refuses a fractional amount instead of silently rounding it', async () => {
    const { CinetPayAdapter } = require('./psp/providers/cinetpay.adapter');
    const adapter = new CinetPayAdapter({ get: (_k: string, d?: any) => d ?? 'x' } as any);
    await expect(adapter.createPaymentIntent({ amount_cents: 149, currency: 'USD', customer: {} } as any)).rejects.toBeInstanceOf(BadRequestException);
  });
});
