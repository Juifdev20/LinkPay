import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CinetPayClient, parseNotification, Currency } from 'cinetpay-js';
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
// Uses the official `cinetpay-js` SDK against CinetPay's newer account_key /
// account_password API (sk_test_/sk_live_ prefixed keys, api.cinetpay.net /
// api.cinetpay.co) — the older apikey/site_id Checkout v2 API is being
// migrated away from new merchant accounts, which no longer expose a site_id.
// Country is hardcoded to CD (DR Congo) since LinkPay only operates there.
const COUNTRY = 'CD';

// The new API's webhook only pings that a transaction reached a final state
// (no status field in the notify body) — the real status must always be
// fetched back from CinetPay via getStatus(), which is what
// parseWebhookEvent() does below. This is CinetPay's own recommended
// pattern, and incidentally means an attacker replaying/forging a webhook
// body cannot lie about the outcome: we only trust what our own
// authenticated call to CinetPay returns.
@Injectable()
export class CinetPayAdapter implements PspAdapter {
  readonly provider = 'cinetpay';
  private readonly logger = new Logger(CinetPayAdapter.name);
  private client: CinetPayClient;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('CINETPAY_API_KEY_CD', '');
    const apiPassword = this.configService.get<string>('CINETPAY_API_PASSWORD_CD', '');

    this.client = new CinetPayClient({
      credentials: {
        [COUNTRY]: { apiKey, apiPassword },
      },
    });
  }

  private normalizePhone(phone: string): string {
    if (!phone) return '';
    if (phone.startsWith('+')) return phone;
    // DR Congo country code is +243 — strip leading 0 if present
    const local = phone.replace(/^0+/, '');
    return `+243${local}`;
  }

  async createPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntentResult> {
    // CinetPay amounts are whole currency units (e.g. 1500 = 1500 CDF), not
    // the cents/centimes LinkPay uses internally everywhere else.
    const amount = Math.round(params.amount_cents / 100);
    const [firstName, ...rest] = (params.customer?.name || 'Client').split(' ');
    const phone = this.normalizePhone(params.customer?.phone || '');

    const payment = await this.client.payment.initialize(
      {
        currency: params.currency as Currency,
        merchantTransactionId: params.reference,
        amount,
        lang: 'fr',
        designation: `LinkPay - ${params.reference}`,
        clientEmail: params.customer?.email || 'client@linkpay.cd',
        clientFirstName: firstName || 'Client',
        clientLastName: rest.join(' ') || '-',
        clientPhoneNumber: phone,
        successUrl: params.redirect_url,
        failedUrl: params.redirect_url,
        notifyUrl: params.webhook_url,
        channel: 'PUSH',
      },
      COUNTRY,
    );

    return {
      psp_intent_id: params.reference,
      checkout_url: payment.paymentUrl,
      status: 'PENDING',
    };
  }

  verifyWebhook(payload: Buffer, signature: string, headers: Record<string, string>): boolean {
    try {
      const notification = parseNotification(JSON.parse(payload.toString()));
      return Boolean(notification.transactionId && notification.merchantTransactionId);
    } catch {
      return false;
    }
  }

  async parseWebhookEvent(payload: Buffer, headers: Record<string, string>): Promise<WebhookEventResult> {
    const body = JSON.parse(payload.toString());
    const notification = parseNotification(body);

    // Always re-confirm with CinetPay directly rather than trusting the
    // webhook body — see the note above the class.
    const statusResult = await this.client.payment.getStatus(notification.transactionId, COUNTRY);
    const status: 'SUCCESS' | 'FAILED' | 'PENDING' =
      statusResult.status === 'SUCCESS' ? 'SUCCESS' : statusResult.status === 'FAILED' ? 'FAILED' : 'PENDING';

    return {
      event_id: notification.transactionId,
      event_type: status === 'SUCCESS' ? 'payment.succeeded' : status === 'FAILED' ? 'payment.failed' : 'payment.pending',
      psp_intent_id: notification.merchantTransactionId,
      status,
      amount_cents: Math.round(Number((statusResult as any).amount || 0) * 100),
      currency: (statusResult as any).currency || 'CDF',
      reference: notification.merchantTransactionId,
      raw: body,
    };
  }

  async refund(params: RefundParams): Promise<RefundResult> {
    // CinetPay's API does not expose a programmatic refund endpoint tied to
    // an original transaction — refunds are processed manually from the
    // CinetPay merchant dashboard. Failing loudly here beats silently
    // pretending it worked.
    this.logger.warn(`CinetPay refund requested for ${params.psp_intent_id} — no refund API available, must be done manually in the CinetPay dashboard`);
    throw new BadRequestException(
      'Le remboursement automatique n\'est pas disponible pour CinetPay — traitez-le manuellement depuis le tableau de bord CinetPay.',
    );
  }

  async getTransactionStatus(psp_intent_id: string): Promise<TransactionStatusResult> {
    const statusResult = await this.client.payment.getStatus(psp_intent_id, COUNTRY);
    const status = statusResult.status === 'SUCCESS' ? 'SUCCESS' : statusResult.status === 'FAILED' ? 'FAILED' : 'PENDING';

    return {
      status,
      amount_cents: Math.round(Number((statusResult as any).amount || 0) * 100),
      currency: (statusResult as any).currency || 'CDF',
    };
  }
}
