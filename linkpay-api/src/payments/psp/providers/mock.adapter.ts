import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PspAdapter, CreatePaymentIntentParams, PaymentIntentResult, WebhookEventResult, RefundParams, RefundResult, TransactionStatusResult, PayoutParams, PayoutResult, PayoutStatusResult } from '../psp.adapter';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class MockPspAdapter implements PspAdapter {
  readonly provider = 'mock';
  private readonly logger = new Logger(MockPspAdapter.name);

  // In-memory only: lets getPayoutStatus() answer like a real provider would
  // (known / unknown reference) while developing without one.
  private readonly payouts = new Map<string, string>();

  constructor(private configService: ConfigService) {}

  async createPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntentResult> {
    const pspIntentId = `mock_${uuidv4().replace(/-/g, '')}`;
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:5173');

    this.logger.log(`Mock PSP: createPaymentIntent for ${params.reference} amount=${params.amount_cents}`);

    return {
      psp_intent_id: pspIntentId,
      checkout_url: `${frontendUrl}/mock-checkout?intent=${pspIntentId}&ref=${params.reference}`,
      status: 'PENDING',
    };
  }

  verifyWebhook(payload: Buffer, signature: string, headers: Record<string, string>): boolean {
    this.logger.log('Mock PSP: verifyWebhook — always true in mock mode');
    return true;
  }

  async parseWebhookEvent(payload: Buffer, headers: Record<string, string>): Promise<WebhookEventResult> {
    const body = JSON.parse(payload.toString());
    return {
      event_id: body.event_id || `evt_${uuidv4()}`,
      event_type: body.event_type || 'payment.succeeded',
      psp_intent_id: body.psp_intent_id,
      status: body.status || 'SUCCESS',
      amount_cents: body.amount_cents || 0,
      currency: body.currency || 'CDF',
      reference: body.reference || '',
      raw: body,
    };
  }

  async refund(params: RefundParams): Promise<RefundResult> {
    this.logger.log(`Mock PSP: refund for ${params.psp_intent_id} amount=${params.amount_cents}`);
    return {
      psp_refund_id: `mock_refund_${uuidv4().replace(/-/g, '')}`,
      status: 'COMPLETED',
    };
  }

  async getTransactionStatus(psp_intent_id: string): Promise<TransactionStatusResult> {
    this.logger.log(`Mock PSP: getTransactionStatus for ${psp_intent_id}`);
    return {
      status: 'SUCCESS',
      amount_cents: 0,
      currency: 'CDF',
    };
  }

  async payout(params: PayoutParams): Promise<PayoutResult> {
    this.logger.log(`Mock PSP: payout ${params.reference} amount=${params.amount_cents} ${params.currency} via ${params.channel} — no money is sent`);
    const id = `mock_payout_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
    this.payouts.set(params.reference, id);
    return { psp_payout_id: id, status: 'SUCCESS' };
  }

  async getPayoutStatus(reference: string): Promise<PayoutStatusResult> {
    const id = this.payouts.get(reference);
    return id ? { status: 'SUCCESS', psp_payout_id: id } : { status: 'NOT_FOUND' };
  }
}
