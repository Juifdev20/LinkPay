import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import {
  PspAdapter,
  CreatePaymentIntentParams,
  PaymentIntentResult,
  WebhookEventResult,
  RefundParams,
  RefundResult,
  TransactionStatusResult,
} from '../psp.adapter';

// CinetPay integration — chosen over Flutterwave because it explicitly covers
// DR Congo (Orange Money, Airtel Money, M-Pesa) in CDF/USD, which Flutterwave's
// mobile money rails do not (Flutterwave's Francophone mobile money endpoint is
// CFA-zone only: Cameroon, Côte d'Ivoire, Mali, Senegal, Burkina Faso).
//
// NOTE: built from CinetPay's public documentation and SDK samples without a
// live sandbox account to test against. Field names/response shape should be
// re-verified against a real CinetPay sandbox response once credentials are
// available (see the "Vérification" section of the integration plan) —
// treat this as a first pass, not a confirmed-working integration yet.
const CINETPAY_BASE_URL = 'https://api-checkout.cinetpay.com/v2';

@Injectable()
export class CinetPayAdapter implements PspAdapter {
  readonly provider = 'cinetpay';
  private readonly logger = new Logger(CinetPayAdapter.name);

  constructor(private configService: ConfigService) {}

  private get apiKey(): string {
    return this.configService.get<string>('CINETPAY_API_KEY', '');
  }

  private get siteId(): string {
    return this.configService.get<string>('CINETPAY_SITE_ID', '');
  }

  private get webhookSecret(): string {
    return this.configService.get<string>('PSP_WEBHOOK_SECRET', '');
  }

  async createPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntentResult> {
    if (!this.apiKey || !this.siteId) {
      throw new Error('CINETPAY_API_KEY / CINETPAY_SITE_ID are not configured');
    }

    // CinetPay amounts are whole currency units (e.g. 1500 = 1500 CDF), not
    // the cents/centimes LinkPay uses internally everywhere else.
    const amount = Math.round(params.amount_cents / 100);

    const body = {
      apikey: this.apiKey,
      site_id: this.siteId,
      transaction_id: params.reference,
      amount,
      currency: params.currency,
      description: `LinkPay - ${params.reference}`,
      notify_url: params.webhook_url,
      return_url: params.redirect_url,
      channels: 'ALL', // CinetPay's own hosted page lets the customer pick Mobile Money / card
      customer_name: params.customer?.name || 'Client',
      customer_surname: '-',
      customer_email: params.customer?.email || 'client@linkpay.cd',
      customer_phone_number: params.customer?.phone || '',
      customer_address: '-',
      customer_city: 'Kinshasa',
      customer_country: 'CD',
      customer_state: 'CD',
      customer_zip_code: '00000',
      metadata: JSON.stringify(params.metadata || {}),
    };

    const response = await fetch(`${CINETPAY_BASE_URL}/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const result: any = await response.json();

    if (!response.ok || result.code !== '201' || !result.data?.payment_url) {
      this.logger.error(`CinetPay payment initiation failed: ${JSON.stringify(result)}`);
      throw new Error(result.description || result.message || 'CinetPay payment initiation failed');
    }

    return {
      psp_intent_id: params.reference,
      checkout_url: result.data.payment_url,
      status: 'PENDING',
    };
  }

  verifyWebhook(payload: Buffer, signature: string, headers: Record<string, string>): boolean {
    const token = headers['x-token'] || signature;
    if (!token || !this.webhookSecret) {
      return false;
    }

    let body: Record<string, any>;
    try {
      body = JSON.parse(payload.toString());
    } catch {
      return false;
    }

    // Order documented by CinetPay for the notify HMAC-SHA256 signature.
    const fields = [
      'cpm_site_id', 'cpm_trans_id', 'cpm_trans_date', 'cpm_amount', 'cpm_currency',
      'signature', 'payment_method', 'cel_phone', 'cpm_phone_prefixe', 'cpm_language',
      'cpm_version', 'cpm_payment_config', 'cpm_page_action', 'cpm_custom',
      'cpm_designation', 'cpm_error_message',
    ];
    const concatenated = fields.map((f) => body[f] ?? '').join('');
    const expected = createHmac('sha256', this.webhookSecret).update(concatenated).digest('hex');

    return expected === token;
  }

  parseWebhookEvent(payload: Buffer, headers: Record<string, string>): WebhookEventResult {
    const body = JSON.parse(payload.toString());

    // CinetPay doesn't include an explicit boolean success flag in the
    // notify payload documented so far — an empty cpm_error_message is
    // treated as success. Re-verify against a real payload once available;
    // calling getTransactionStatus() before trusting this is the safer bet.
    const status: 'SUCCESS' | 'FAILED' = body.cpm_error_message ? 'FAILED' : 'SUCCESS';

    return {
      event_id: `${body.cpm_trans_id}_${body.cpm_trans_date}`,
      event_type: status === 'SUCCESS' ? 'payment.succeeded' : 'payment.failed',
      psp_intent_id: body.cpm_trans_id,
      status,
      amount_cents: Math.round(parseFloat(body.cpm_amount || '0') * 100),
      currency: body.cpm_currency || 'CDF',
      reference: body.cpm_trans_id,
      raw: body,
    };
  }

  async refund(params: RefundParams): Promise<RefundResult> {
    // CinetPay's public API does not document a programmatic refund
    // endpoint — refunds are processed manually from the CinetPay merchant
    // dashboard. Failing loudly here beats silently pretending it worked.
    this.logger.warn(`CinetPay refund requested for ${params.psp_intent_id} — no refund API available, must be done manually in the CinetPay dashboard`);
    throw new BadRequestException(
      'Le remboursement automatique n\'est pas disponible pour CinetPay — traitez-le manuellement depuis le tableau de bord CinetPay.',
    );
  }

  async getTransactionStatus(psp_intent_id: string): Promise<TransactionStatusResult> {
    const response = await fetch(`${CINETPAY_BASE_URL}/payment/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apikey: this.apiKey,
        site_id: this.siteId,
        transaction_id: psp_intent_id,
      }),
    });

    const result: any = await response.json();

    if (!response.ok) {
      throw new Error(result.description || result.message || 'CinetPay status check failed');
    }

    const cinetpayStatus = result.data?.status;
    const status = cinetpayStatus === 'ACCEPTED' ? 'SUCCESS' : cinetpayStatus === 'REFUSED' ? 'FAILED' : 'PENDING';

    return {
      status,
      amount_cents: Math.round(parseFloat(result.data?.amount || '0') * 100),
      currency: result.data?.currency || 'CDF',
    };
  }
}
