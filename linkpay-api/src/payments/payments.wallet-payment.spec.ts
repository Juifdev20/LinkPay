import { BadRequestException, ConflictException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { createFakeSupabase, has, RecordedQuery } from '../test-utils/fake-supabase';

const REQUEST = { id: 'pr1', status: 'CREATED', amount_cents: 100000, currency: 'CDF', merchant_id: 'm1', reference: 'SLP-1', commission_model: 'MERCHANT_PAID', link_token: 'tok' };
const INTENT = { id: 'i1', payment_request_id: 'pr1', amount_cents: 100000, currency: 'CDF', client_id: 'payer' };
const TX = { id: 'tx1', reference: 'TX-SLP-1' };

function setup(opts: { existingTx?: any; existingIntent?: any; reverseError?: boolean } = {}) {
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'payment_requests') return has(q, 'update') ? { data: REQUEST } : { data: REQUEST };
    if (q.target === 'payment_intents') {
      if (has(q, 'insert')) return { data: INTENT };
      if (has(q, 'eq', 'idempotency_key')) return { data: opts.existingIntent ?? null };
      return { data: null };
    }
    if (q.target === 'wallets') return { data: { id: 'wp', status: 'ACTIVE', user_id: 'payer' } };
    if (q.target === 'transactions') return { data: opts.existingTx ?? null };
    if (q.target === 'rpc:debit_wallet') return { data: 1 };
    if (q.target === 'rpc:credit_wallet') return opts.reverseError ? { error: { message: 'db down' } } : { data: 1 };
    return undefined;
  });
  const alerts = { alert: jest.fn() };
  const sales = { markPaidByPaymentRequest: jest.fn(async () => undefined) };
  const commissions = { calculateFeesPreview: async () => ({ total_cents: 100000, total_fees_cents: 0 }) };
  const service = new PaymentsService(
    fake.service, {} as any, commissions as any, {} as any, {} as any, { create: jest.fn() } as any, {} as any, { get: () => undefined } as any,
    { verifyPin: jest.fn() } as any, { getRule: async () => ({}), assertWithinLimits: async () => undefined } as any, { log: jest.fn(async () => undefined) } as any,
    { maybeRoundUp: jest.fn(async () => null) } as any, sales as any, {} as any, alerts as any,
  );
  const handle = jest.spyOn(service as any, 'handleSuccessfulPayment');
  const reversals = () => fake.queries.filter((q) => q.target === 'rpc:credit_wallet').length;
  return { service, handle, sales, alerts, reversals, fake };
}

describe('PaymentsService.payWithWallet — refund the payer only when nobody was paid', () => {
  it('a normal payment succeeds and nobody is refunded', async () => {
    const { service, handle, reversals } = setup();
    handle.mockResolvedValue(TX);
    await expect(service.payWithWallet('payer', 'tok', '1234', 'k1')).resolves.toMatchObject({ status: 'SUCCESS', reference: 'TX-SLP-1' });
    expect(reversals()).toBe(0);
  });

  it('a step AFTER the merchant transaction fails: the payment stands, the payer is NOT refunded (the merchant is paid)', async () => {
    const { service, handle, reversals } = setup({ existingTx: TX });
    handle.mockRejectedValue(new Error('ledger write failed'));
    await expect(service.payWithWallet('payer', 'tok', '1234', 'k1')).resolves.toMatchObject({ status: 'SUCCESS' });
    expect(reversals()).toBe(0);
  });

  it('nothing was recorded (an exception): the payer gets their money back, the intent fails and the invoice reopens', async () => {
    const { service, handle, reversals, fake } = setup();
    handle.mockRejectedValue(new Error('db down'));
    await expect(service.payWithWallet('payer', 'tok', '1234', 'k1')).rejects.toBeInstanceOf(BadRequestException);
    expect(reversals()).toBe(1);
    expect(fake.queries.some((q) => q.target === 'payment_intents' && has(q, 'update', { status: 'FAILED' } as any) || q.calls.some((c) => c.method === 'update' && c.args[0]?.status === 'FAILED'))).toBe(true);
  });

  it('nothing was recorded (handleSuccessfulPayment silently returned nothing): reported as a failure and refunded, never as a success', async () => {
    const { service, handle, reversals } = setup();
    handle.mockResolvedValue(undefined);
    await expect(service.payWithWallet('payer', 'tok', '1234', 'k1')).rejects.toBeInstanceOf(BadRequestException);
    expect(reversals()).toBe(1);
  });

  it('a failed refund is never silent: a critical alert is raised for the admins', async () => {
    const { service, handle, alerts } = setup({ reverseError: true });
    handle.mockResolvedValue(undefined);
    await expect(service.payWithWallet('payer', 'tok', '1234', 'k1')).rejects.toBeInstanceOf(BadRequestException);
    expect(alerts.alert).toHaveBeenCalledWith(expect.objectContaining({ severity: 'critical' }));
  });

  it('a sale that cannot be marked paid does not undo a completed payment', async () => {
    const { service, handle, sales, reversals } = setup();
    handle.mockResolvedValue(TX);
    sales.markPaidByPaymentRequest.mockRejectedValue(new Error('sales down'));
    await expect(service.payWithWallet('payer', 'tok', '1234', 'k1')).resolves.toMatchObject({ status: 'SUCCESS' });
    expect(reversals()).toBe(0);
  });

  it("someone else's payment is never returned for a reused idempotency key", async () => {
    const { service } = setup({ existingIntent: { id: 'i-other', status: 'SUCCEEDED', client_id: 'someone-else' } });
    await expect(service.payWithWallet('payer', 'tok', '1234', 'k1')).rejects.toBeInstanceOf(ConflictException);
    const { service: mine } = setup({ existingIntent: { id: 'i-mine', status: 'SUCCEEDED', client_id: 'payer' } });
    await expect(mine.payWithWallet('payer', 'tok', '1234', 'k1')).resolves.toMatchObject({ payment_intent_id: 'i-mine' });
  });
});
