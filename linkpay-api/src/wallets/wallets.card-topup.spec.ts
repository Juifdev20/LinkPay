import { BadRequestException } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { createFakeSupabase, has, RecordedQuery } from '../test-utils/fake-supabase';

const REF = /^TOPUP-\d{8}-[0-9A-F]{6}$/;

function setup(opts: { provider: string; cardOn?: boolean }) {
  const inserted: any[] = [];
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'profiles') return { data: { full_name: 'Amina K', email: 'a@x.com', phone: '+243828497218' } };
    if (q.target === 'wallet_topups') {
      if (has(q, 'insert')) { inserted.push(q.calls.find((c) => c.method === 'insert')!.args[0]); return { data: { id: 't1', status: 'PENDING' } }; }
      return { data: null }; // no earlier top-up with this idempotency key
    }
    return undefined;
  });
  const adapter = {
    provider: opts.provider,
    createPaymentIntent: jest.fn(async (p: any) => ({ psp_intent_id: p.reference, checkout_url: 'https://pay.flexpaie.test/card/abc', status: 'PENDING' })),
  };
  const config = { get: (k: string, d?: any) => ({ FRONTEND_URL: 'https://app.example', BACKEND_URL: 'https://api.example', CARD_PAYMENTS_ENABLED: opts.cardOn ? 'true' : '' } as any)[k] ?? d };
  const self: any = {
    supabaseService: fake.service,
    pspFactory: { get: () => adapter },
    configService: config,
    logger: { error: jest.fn(), warn: jest.fn() },
    getWalletByUserId: async () => ({ id: 'wal1', status: 'ACTIVE' }),
  };
  self.paymentMethods = WalletsService.prototype.paymentMethods.bind(self);
  const topup = (method: string, operator?: string, phone?: string) => (WalletsService.prototype.initiateTopup as any).call(self, 'u1', 500000, 'CDF', 'key-1', method, operator, phone);
  return { adapter, inserted, topup, self };
}

describe('paying a top-up by bank card', () => {
  it('is closed by default with FlexPaie: nothing is sent to the provider, whoever calls the API', async () => {
    const { adapter, topup } = setup({ provider: 'flexpaie', cardOn: false });
    await expect(topup('card')).rejects.toBeInstanceOf(BadRequestException);
    await expect(topup('card')).rejects.toThrow(/pas encore disponible/);
    expect(adapter.createPaymentIntent).not.toHaveBeenCalled();
  });

  it('switched on (CARD_PAYMENTS_ENABLED=true): goes to the provider page and comes back to the neutral return page', async () => {
    const { adapter, inserted, topup } = setup({ provider: 'flexpaie', cardOn: true });
    const r = await topup('card');
    const call = adapter.createPaymentIntent.mock.calls[0][0];
    expect(call.metadata.payment_method).toBe('card');
    expect(call.reference).toMatch(REF);
    expect(call.redirect_url).toBe(`https://app.example/payment/return?to=topup&ref=${call.reference}`);
    expect(call.webhook_url).toBe('https://api.example/api/v1/webhooks/flexpaie');
    expect(call.amount_cents).toBe(500000);
    expect(r.checkout_url).toBe('https://pay.flexpaie.test/card/abc');
    expect(inserted[0]).toMatchObject({ status: 'PENDING', psp_provider: 'flexpaie', psp_intent_id: call.reference, amount_cents: 500000, currency: 'CDF' });
  });

  it('needs no phone number (the money comes from the card), unlike Mobile Money', async () => {
    const { topup, adapter } = setup({ provider: 'flexpaie', cardOn: true });
    await expect(topup('card')).resolves.toBeDefined();
    await expect(topup('mobile_money', 'airtel', '')).rejects.toThrow(/Numéro Mobile Money requis/);
    expect(adapter.createPaymentIntent).toHaveBeenCalledTimes(1);
  });

  it('Mobile Money keeps coming back to our own result page', async () => {
    const { adapter, topup } = setup({ provider: 'flexpaie', cardOn: true });
    await topup('mobile_money', 'airtel', '+243973456789');
    const call = adapter.createPaymentIntent.mock.calls[0][0];
    expect(call.redirect_url).toBe(`https://app.example/dashboard/wallet/topup/result?ref=${call.reference}`);
  });

  it('the app is told what is open', () => {
    expect(setup({ provider: 'flexpaie', cardOn: false }).self.paymentMethods()).toEqual({ mobile_money: true, card: false });
    expect(setup({ provider: 'flexpaie', cardOn: true }).self.paymentMethods()).toEqual({ mobile_money: true, card: true });
    expect(setup({ provider: 'cinetpay', cardOn: true }).self.paymentMethods()).toEqual({ mobile_money: true, card: false });
    expect(setup({ provider: 'mock' }).self.paymentMethods().card).toBe(true);
  });
});
