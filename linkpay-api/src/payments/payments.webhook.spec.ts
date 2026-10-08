import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CinetPayAdapter } from './psp/providers/cinetpay.adapter';
import { createFakeSupabase } from '../test-utils/fake-supabase';

const MOCK_BODY = Buffer.from(JSON.stringify({ psp_intent_id: 'SLP-20261008-ABC123', status: 'SUCCESS', event_id: 'evt1' }));

function makeService(configuredProvider: string, intent: any = null) {
  const fake = createFakeSupabase((q) => {
    if (q.target === 'payment_intents') return { data: intent };
    return { data: null };
  });
  const mockAdapter = {
    verifyWebhook: () => true,
    parseWebhookEvent: async () => ({ event_id: 'evt1', event_type: 'payment.succeeded', psp_intent_id: 'SLP-20261008-ABC123', status: 'SUCCESS', amount_cents: 0, currency: 'CDF', reference: '', raw: {} }),
  };
  const pspFactory = { get: (p?: string) => { if (p !== 'mock' && p !== 'cinetpay') throw new Error('nope'); return mockAdapter; } };
  const config = { get: (k: string, d?: any) => (k === 'PSP_PROVIDER' ? configuredProvider : d) };
  const service = new PaymentsService(fake.service, pspFactory as any, {} as any, {} as any, {} as any, {} as any, {} as any, config as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  const handleSuccess = jest.spyOn(service as any, 'handleSuccessfulPayment').mockResolvedValue(undefined);
  return { service, handleSuccess };
}

describe('PaymentsService.processWebhook', () => {
  it('rejects a forged "mock" webhook when the deployment runs on CinetPay', async () => {
    const { service, handleSuccess } = makeService('cinetpay', { id: 'i1', psp_provider: 'cinetpay' });
    await expect(service.processWebhook('mock', MOCK_BODY, '', {})).rejects.toBeInstanceOf(NotFoundException);
    expect(handleSuccess).not.toHaveBeenCalled();
  });

  it('still accepts mock webhooks on a deployment that runs on the mock provider (dev)', async () => {
    const { service, handleSuccess } = makeService('mock', { id: 'i1', psp_provider: 'mock' });
    await expect(service.processWebhook('mock', MOCK_BODY, '', {})).resolves.toMatchObject({ status: 'processed' });
    expect(handleSuccess).toHaveBeenCalled();
  });

  it("refuses a webhook from a provider other than the intent's own", async () => {
    const { service, handleSuccess } = makeService('mock', { id: 'i1', psp_provider: 'cinetpay' });
    await expect(service.processWebhook('mock', MOCK_BODY, '', {})).rejects.toBeInstanceOf(BadRequestException);
    expect(handleSuccess).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown provider', async () => {
    const { service } = makeService('cinetpay');
    await expect(service.processWebhook('whatever', MOCK_BODY, '', {})).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CinetPayAdapter.parseWebhookEvent', () => {
  const adapterWith = (statusResult: any) => {
    const adapter: any = Object.create(CinetPayAdapter.prototype);
    adapter.logger = { warn: jest.fn(), log: jest.fn() };
    adapter.client = { payment: { getStatus: async () => statusResult } };
    return adapter as CinetPayAdapter;
  };
  const body = (merchantTransactionId: string) =>
    Buffer.from(JSON.stringify({ notify_token: 'nt', transaction_id: 'T-REAL', merchant_transaction_id: merchantTransactionId }));

  it("refuses a genuine CinetPay payment replayed for someone else's payment", async () => {
    const adapter = adapterWith({ status: 'SUCCESS', code: 100, transactionId: 'T-REAL', merchantTransactionId: 'SLP-SMALL-1' });
    await expect(adapter.parseWebhookEvent(body('SLP-BIG-2'), {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts the webhook when CinetPay confirms the same merchant transaction', async () => {
    const adapter = adapterWith({ status: 'SUCCESS', code: 100, transactionId: 'T-REAL', merchantTransactionId: 'SLP-SMALL-1' });
    await expect(adapter.parseWebhookEvent(body('SLP-SMALL-1'), {})).resolves.toMatchObject({ status: 'SUCCESS', psp_intent_id: 'SLP-SMALL-1' });
  });
});
