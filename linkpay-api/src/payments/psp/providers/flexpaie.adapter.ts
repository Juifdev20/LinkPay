import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../../supabase/supabase.service';
import {
  PspAdapter,
  CreatePaymentIntentParams,
  PaymentIntentResult,
  WebhookEventResult,
  RefundParams,
  RefundResult,
  TransactionStatusResult,
  PayoutParams,
  PayoutResult,
  PayoutStatusResult,
  PayoutNotSentError,
} from '../psp.adapter';
import { isWholeCurrencyUnits } from '../amount-check';

/**
 * FlexPaie (Infoset) — "API de Paiement", corporate v2.0.
 *
 *   POST <paymentService>   Authorization: Bearer <token>   body JSON
 *        type "1" = Mobile Money: a push message is sent to the customer's phone
 *        type "2" = bank card: the answer carries a page `url` to send the customer to
 *   GET  <check>/<orderNumber>
 *
 * In production FlexPaie gives three separate addresses (Mobile Money, card, and status check on yet another
 * host): FLEXPAIE_MOMO_URL, FLEXPAIE_CARD_URL and FLEXPAIE_CHECK_URL. FLEXPAIE_BASE_URL (one host serving
 * `/api/rest/v1/paymentService` and `/api/rest/v1/check/…`, as in their test documentation) remains the fallback
 * for any of the three that is not set.
 *
 * What the documentation does NOT give, and what that means here:
 *  - The callback sent to `callback_url` carries NO signature. It is therefore only ever a hint: the real status is
 *    always read back from FlexPaie (check), with the order number WE recorded for that reference — the same pattern
 *    as the CinetPay adapter. A forged callback can at most make us ask FlexPaie a question.
 *  - No API to send money (withdrawals, merchant payouts) and no refund API is documented: payout() and refund()
 *    say so instead of pretending.
 *
 * Everywhere else in ScanLinkPay a payment is found by OUR reference (it travels in the return link and is stored as
 * psp_intent_id). FlexPaie only knows its own orderNumber, so the pair is kept in `flexpaie_orders` (migration 060).
 */
const TIMEOUT_MS = 20_000;

/** Check-transaction status codes (documentation, "Check transaction"). Anything unknown is treated as "still waiting". */
const STATUS: Record<string, 'SUCCESS' | 'FAILED' | 'PENDING'> = {
  '0': 'SUCCESS', // processed successfully
  '1': 'FAILED', // did not succeed
  '2': 'PENDING', // waiting for the customer
  '3': 'FAILED', // about to be refunded to the customer
  '4': 'FAILED', // refunded to the customer
  '5': 'FAILED', // cancelled by the merchant
};

export function mapFlexPaieStatus(code: unknown): 'SUCCESS' | 'FAILED' | 'PENDING' {
  return STATUS[String(code).trim()] ?? 'PENDING';
}

/** "0891234567", "+243 89 123 45 67", "891234567" → "243891234567" (the format FlexPaie expects, no "+"). */
export function toFlexPaieMsisdn(phone: string | undefined | null): string {
  let digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith('0')) digits = `243${digits.slice(1)}`;
  else if (digits.length === 9) digits = `243${digits}`;
  if (!/^243\d{9}$/.test(digits)) {
    throw new BadRequestException('Numéro de téléphone invalide. Utilisez le format international (ex: +243XXXXXXXXX).');
  }
  return digits;
}

const toCents = (value: unknown): number => {
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

@Injectable()
export class FlexPaieAdapter implements PspAdapter {
  readonly provider = 'flexpaie';
  // No API to send money out is documented: withdrawals are settled by an admin, by hand.
  readonly supportsPayout = false;
  private readonly logger = new Logger(FlexPaieAdapter.name);

  constructor(private configService: ConfigService, private supabaseService: SupabaseService) {
    if (this.configService.get('NODE_ENV') === 'production') {
      for (const url of [this.paymentUrl(false), this.paymentUrl(true), this.checkUrl()]) {
        if (url.startsWith('http://')) {
          this.logger.warn('A FlexPaie address is plain http: the authorization token travels unencrypted. Ask FlexPaie for an https address.');
          break;
        }
      }
    }
  }

  private env(key: string): string {
    return String(this.configService.get<string>(key, '') ?? '').trim().replace(/\/+$/, '');
  }

  /** The address to POST a payment to: Mobile Money and card can live on different hosts. */
  private paymentUrl(card: boolean): string {
    const own = this.env(card ? 'FLEXPAIE_CARD_URL' : 'FLEXPAIE_MOMO_URL');
    if (own) return own;
    const base = this.env('FLEXPAIE_BASE_URL');
    return base ? `${base}/api/rest/v1/paymentService` : '';
  }

  /** The address to ask about an order, WITHOUT the order number. The "…/ORDER_NUMBER_A_REMPLACER" placeholder of the e-mail is tolerated. */
  private checkUrl(): string {
    const own = this.env('FLEXPAIE_CHECK_URL').replace(/\/ORDER[A-Z_]*$/i, '');
    if (own) return own;
    const base = this.env('FLEXPAIE_BASE_URL');
    return base ? `${base}/api/rest/v1/check` : '';
  }

  private merchant(): string {
    return String(this.configService.get<string>('FLEXPAIE_MERCHANT', '') ?? '').trim();
  }

  private authorization(): string {
    const token = String(this.configService.get<string>('FLEXPAIE_TOKEN', '') ?? '').trim();
    return /^bearer\s/i.test(token) ? token : `Bearer ${token}`;
  }

  private assertConfigured(url: string) {
    if (!url || !this.merchant() || !String(this.configService.get('FLEXPAIE_TOKEN', '') ?? '').trim()) {
      throw new Error('FlexPaie is not configured (FLEXPAIE_MOMO_URL / FLEXPAIE_CARD_URL / FLEXPAIE_CHECK_URL or FLEXPAIE_BASE_URL, FLEXPAIE_MERCHANT, FLEXPAIE_TOKEN)');
    }
  }

  /** One call to FlexPaie at a full address. Never logs the token or the body. */
  private async call(method: 'GET' | 'POST', url: string, body?: Record<string, unknown>): Promise<any> {
    this.assertConfigured(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { Authorization: this.authorization(), 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err: any) {
      // "fetch failed" alone says nothing: the cause (ENOTFOUND = unknown host, ECONNREFUSED, a certificate error, a
      // proxy that does not answer…) and the host (never the path, the token or the body) are what tells them apart.
      const cause = err?.cause?.code || err?.cause?.message || '';
      let host = '';
      try { host = new URL(url).host; } catch { host = 'invalid address'; }
      throw new Error(`FlexPaie unreachable: ${err?.name === 'AbortError' ? 'timeout' : err?.message}${cause ? ` (${String(cause).slice(0, 120)})` : ''} [host: ${host}]`);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 || res.status === 403) throw new Error(`FlexPaie Authentication failed (HTTP ${res.status})`);
    if (!res.ok) throw new Error(`FlexPaie HTTP ${res.status}`);
    try {
      return await res.json();
    } catch {
      throw new Error('FlexPaie answered something that is not JSON');
    }
  }

  // ---------------------------------------------------------------- collecting

  async createPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntentResult> {
    // A fraction of a unit: not documented as accepted, and rounding it would charge less than we credit.
    if (!isWholeCurrencyUnits(params.amount_cents)) {
      throw new BadRequestException("Ce mode de paiement n'accepte que des montants entiers (sans centimes).");
    }
    const card = params.metadata?.payment_method === 'card';
    const base: Record<string, unknown> = {
      merchant: this.merchant(),
      type: card ? '2' : '1',
      reference: params.reference,
      amount: String(params.amount_cents / 100),
      currency: params.currency,
      callback_url: params.webhook_url,
    };
    if (card) {
      // Whatever the outcome, the customer comes back to the same page: it asks the API what happened.
      Object.assign(base, { approve_url: params.redirect_url, cancel_url: params.redirect_url, decline_url: params.redirect_url });
    } else {
      if (!params.customer?.phone) throw new BadRequestException('Numéro Mobile Money requis pour cette méthode de paiement');
      base.phone = toFlexPaieMsisdn(params.customer.phone);
    }

    const answer = await this.call('POST', this.paymentUrl(card), base);
    if (String(answer?.code) !== '0' || !answer?.orderNumber) {
      this.logger.warn(`FlexPaie refused ${params.reference}: code=${answer?.code} message=${String(answer?.message).slice(0, 120)}`);
      throw new Error(`FlexPaie refused the payment: ${String(answer?.message ?? 'no message').slice(0, 200)}`);
    }
    const orderNumber = String(answer.orderNumber);

    let checkoutUrl: string;
    if (card) {
      try {
        const u = new URL(String(answer.url));
        if (u.protocol !== 'https:') throw new Error('not https');
        checkoutUrl = u.toString();
      } catch {
        throw new Error('FlexPaie did not give a usable card payment page');
      }
    } else {
      // Mobile Money: the customer validates the push on their phone. The "checkout" page is OUR result page, which
      // waits for the confirmation (webhook or status check).
      checkoutUrl = params.redirect_url;
    }

    // Without this link a payment could not be verified: tried a few times, loudly refused if it never works.
    let saved = false;
    for (let i = 0; i < 3 && !saved; i++) {
      const { error } = await this.supabaseService.getClient().from('flexpaie_orders').insert({ reference: params.reference, order_number: orderNumber });
      if (!error) saved = true;
      else this.logger.error(`Could not record the FlexPaie order ${orderNumber} for ${params.reference}: ${error.message}`);
    }
    if (!saved) throw new Error('Could not record the FlexPaie order number (is migration 060 applied?)');

    return { psp_intent_id: params.reference, checkout_url: checkoutUrl, status: 'PENDING' };
  }

  private async orderNumberOf(reference: string): Promise<string | null> {
    const { data } = await this.supabaseService.getClient().from('flexpaie_orders').select('order_number').eq('reference', reference).maybeSingle();
    return data?.order_number ?? null;
  }

  /** Asks FlexPaie about one order. `transaction` is null when they know no such order. */
  private async check(orderNumber: string): Promise<{ transaction: any | null }> {
    const answer = await this.call('GET', `${this.checkUrl()}/${encodeURIComponent(orderNumber)}`);
    return { transaction: answer?.transaction ?? null };
  }

  async getTransactionStatus(psp_intent_id: string): Promise<TransactionStatusResult> {
    const orderNumber = await this.orderNumberOf(psp_intent_id);
    if (!orderNumber) {
      this.logger.warn(`FlexPaie: no order number recorded for ${psp_intent_id} — cannot verify yet`);
      return { status: 'PENDING', amount_cents: 0, currency: 'CDF' };
    }
    try {
      const { transaction } = await this.check(orderNumber);
      if (!transaction) return { status: 'PENDING', amount_cents: 0, currency: 'CDF' };
      return { status: mapFlexPaieStatus(transaction.status), amount_cents: toCents(transaction.amount), currency: String(transaction.currency || 'CDF') };
    } catch (err: any) {
      // A hiccup is never a verdict: the payment stays open and is asked about again.
      this.logger.warn(`FlexPaie check failed for ${psp_intent_id}: ${err.message}`);
      return { status: 'PENDING', amount_cents: 0, currency: 'CDF' };
    }
  }

  // ---------------------------------------------------------------- the callback

  private parseCallback(payload: Buffer): Record<string, any> | null {
    const text = payload?.toString?.() ?? '';
    try {
      const json = JSON.parse(text);
      return json && typeof json === 'object' ? json : null;
    } catch {
      // Some gateways post a form instead of JSON.
      const form = Object.fromEntries(new URLSearchParams(text));
      return Object.keys(form).length ? form : null;
    }
  }

  /** The callback has no signature: this only checks it is shaped like one. The real check is parseWebhookEvent's. */
  verifyWebhook(payload: Buffer, _signature: string, _headers: Record<string, string>): boolean {
    const body = this.parseCallback(payload);
    return !!body && typeof body.reference === 'string' && body.reference.length > 0 && body.reference.length <= 100;
  }

  async parseWebhookEvent(payload: Buffer, _headers: Record<string, string>): Promise<WebhookEventResult> {
    const body = this.parseCallback(payload);
    const reference = String(body?.reference ?? '');
    if (!body || !reference) throw new BadRequestException('Invalid webhook');

    // The order number of that reference is the one WE recorded. A callback naming another one is a forgery or an
    // error: refused. (Only when nothing was recorded — a lost write — is the callback's number used, and then the
    // answer must still carry the same reference.)
    const recorded = await this.orderNumberOf(reference);
    const claimed = body.orderNumber ? String(body.orderNumber) : '';
    if (recorded && claimed && recorded !== claimed) {
      this.logger.warn(`FlexPaie callback for ${reference} names order ${claimed}, recorded ${recorded} — refused`);
      throw new BadRequestException('Invalid webhook');
    }
    const orderNumber = recorded || claimed;
    if (!orderNumber) throw new BadRequestException('Invalid webhook');

    const { transaction } = await this.check(orderNumber);
    if (!transaction || String(transaction.reference) !== reference) {
      this.logger.warn(`FlexPaie callback for ${reference}: FlexPaie knows no such order (or one with another reference) — refused`);
      throw new BadRequestException('Invalid webhook');
    }

    const status = mapFlexPaieStatus(transaction.status);
    return {
      event_id: `${orderNumber}:${status}`,
      event_type: status === 'SUCCESS' ? 'payment.succeeded' : status === 'FAILED' ? 'payment.failed' : 'payment.pending',
      psp_intent_id: reference,
      status,
      amount_cents: toCents(transaction.amount),
      currency: String(transaction.currency || 'CDF'),
      reference,
      raw: body,
    };
  }

  // ---------------------------------------------------------------- what the documentation does not offer

  async refund(params: RefundParams): Promise<RefundResult> {
    this.logger.warn(`FlexPaie refund requested for ${params.psp_intent_id} — no refund API documented, must be done with FlexPaie`);
    throw new BadRequestException("Le remboursement automatique n'est pas disponible avec FlexPaie — traitez-le avec FlexPaie.");
  }

  async payout(_params: PayoutParams): Promise<PayoutResult> {
    throw new PayoutNotSentError("Les retraits automatiques ne sont pas encore disponibles : l'envoi d'argent par FlexPaie n'est pas encore connecté.");
  }

  async getPayoutStatus(_reference: string): Promise<PayoutStatusResult> {
    return { status: 'NOT_FOUND' };
  }
}
