import { PaymentsService } from './payments.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

const INTENT = { id: 'i1', payment_request_id: 'pr1', amount_cents: 1000000, currency: 'CDF', client_id: 'client-1' };
const REQUEST = { id: 'pr1', merchant_id: 'm1', reference: 'SLP-1', commission_model: 'MERCHANT_PAID', merchant: { name: 'Shop' } };
const TX = { id: 'tx1', reference: 'TX-SLP-1', net_cents: 955000 };

function setup(creditResult: boolean) {
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'payment_intents') return { data: INTENT };
    if (q.target === 'payment_requests') return { data: REQUEST };
    if (q.target === 'transactions') return { data: TX };
    return undefined;
  });
  const order: string[] = [];
  const credit = jest.fn(async () => { order.push('credit'); return creditResult; });
  const notifications = { create: jest.fn(async () => undefined) };
  const commissions = { calculateFees: async () => ({ psp_fee_cents: 15000, platform_fee_cents: 30000, net_cents: 955000, commission_rule_id: null }) };
  const ledger = { writePaymentEntries: jest.fn(async () => { order.push('ledger'); }) };
  const requests = { markPaid: jest.fn(async () => { order.push('markPaid'); }) };
  const service = new PaymentsService(
    fake.service, {} as any, commissions as any, ledger as any, {} as any, notifications as any, requests as any,
    { get: () => undefined } as any, {} as any, {} as any, {} as any, {} as any, {} as any, { credit } as any,
  );
  jest.spyOn(service as any, 'generateReceipt').mockImplementation(async () => { order.push('receipt'); throw new Error('receipt printer down'); });
  jest.spyOn(service as any, 'getMerchantOwnerId').mockResolvedValue('owner-1');
  return { service, credit, notifications, order };
}

describe('PaymentsService.handleSuccessfulPayment — paying the merchant', () => {
  it("credits the merchant's wallet as soon as the transaction exists, before receipt and notifications", async () => {
    const { service, credit, order } = setup(true);
    await (service as any).handleSuccessfulPayment(INTENT, { psp_intent_id: 'SLP-1' }).catch(() => undefined);
    expect(credit).toHaveBeenCalledWith('tx1');
    expect(order.indexOf('credit')).toBeGreaterThan(order.indexOf('ledger'));
    expect(order.indexOf('credit')).toBeLessThan(order.indexOf('receipt'));
  });

  it('tells the merchant how much landed in the wallet', async () => {
    const { service, notifications } = setup(true);
    jest.spyOn(service as any, 'generateReceipt').mockResolvedValue(undefined);
    await (service as any).handleSuccessfulPayment(INTENT, { psp_intent_id: 'SLP-1' });
    const merchantNote = (notifications.create.mock.calls as any[]).map((c) => c[0]).find((n) => n.type === 'payment_received');
    expect(merchantNote.body).toMatch(/portefeuille ScanLinkPay/);
    expect(merchantNote.body).toMatch(/9[\s  ]?550/);
  });

  it('still succeeds when the credit fails — the retry job will pay the merchant', async () => {
    const { service, notifications } = setup(false);
    jest.spyOn(service as any, 'generateReceipt').mockResolvedValue(undefined);
    await expect((service as any).handleSuccessfulPayment(INTENT, { psp_intent_id: 'SLP-1' })).resolves.toMatchObject({ id: 'tx1' });
    const merchantNote = (notifications.create.mock.calls as any[]).map((c) => c[0]).find((n) => n.type === 'payment_received');
    expect(merchantNote.body).toMatch(/quelques instants/);
  });
});
