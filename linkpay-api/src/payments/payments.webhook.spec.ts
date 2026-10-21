import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
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
  const pspFactory = { get: (p?: string) => { if (p !== 'flexpaie') throw new Error('nope'); return mockAdapter; } };
  const config = { get: (k: string, d?: any) => (k === 'PSP_PROVIDER' ? configuredProvider : d) };
  const service = new PaymentsService(fake.service, pspFactory as any, {} as any, {} as any, {} as any, {} as any, {} as any, config as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, { alert: jest.fn() } as any);
  const handleSuccess = jest.spyOn(service as any, 'handleSuccessfulPayment').mockResolvedValue(undefined);
  return { service, handleSuccess };
}

describe('PaymentsService.processWebhook', () => {
  it('rejects a forged "mock" webhook when the deployment runs on FlexPaie', async () => {
    const { service, handleSuccess } = makeService('flexpaie', { id: 'i1', psp_provider: 'flexpaie' });
    await expect(service.processWebhook('mock', MOCK_BODY, '', {})).rejects.toBeInstanceOf(NotFoundException);
    expect(handleSuccess).not.toHaveBeenCalled();
  });

  it('refuses a "mock" webhook EVERYWHERE, even where PSP_PROVIDER says mock (no fictitious money)', async () => {
    const { service, handleSuccess } = makeService('mock', { id: 'i1', psp_provider: 'mock' });
    await expect(service.processWebhook('mock', MOCK_BODY, '', {})).rejects.toBeInstanceOf(NotFoundException);
    expect(handleSuccess).not.toHaveBeenCalled();
  });

  it("refuses a webhook from a provider other than the intent's own", async () => {
    const { service, handleSuccess } = makeService('flexpaie', { id: 'i1', psp_provider: 'other' });
    await expect(service.processWebhook('flexpaie', MOCK_BODY, '', {})).rejects.toBeInstanceOf(BadRequestException);
    expect(handleSuccess).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown provider', async () => {
    const { service } = makeService('flexpaie');
    await expect(service.processWebhook('whatever', MOCK_BODY, '', {})).rejects.toBeInstanceOf(NotFoundException);
  });
});
