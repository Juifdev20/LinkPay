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
  PayoutRetryLaterError,
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
 *    everywhere else. A forged callback can at most make us ask FlexPaie a question.
 *  - No refund API is documented: refund() says so instead of pretending.
 *  - Sending money (withdrawals) is a separate product, the "PayoutService" (its own login, documentation v1.03):
 *    see the last section of this file.
 *
 * Everywhere else in ScanLinkPay a payment is found by OUR reference (it travels in the return link and is stored as
 * psp_intent_id). FlexPaie only knows its own orderNumber, so the pair is kept in `flexpaie_orders` (migration 060).
 */
const TIMEOUT_MS = 20_000;

/** Connection errors that mean the request never reached FlexPaie (unknown host, nobody listening, no route). */
const NEVER_REACHED = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH']);

class FlexPaieCallError extends Error {
  readonly neverReached: boolean;
  readonly refusedToken: boolean;
  constructor(message: string, opts: { neverReached?: boolean; refusedToken?: boolean } = {}) {
    super(message);
    this.neverReached = !!opts.neverReached;
    this.refusedToken = !!opts.refusedToken;
  }
}

/** A payout stuck in SENDING (no answer, no order number) for this long is taken as never sent: refunded. */
export const PAYOUT_NO_NEWS_MS = 30 * 60_000;
/** A payout FlexPaie keeps refusing as "busy" is given up (refunded) after this long. */
export const PAYOUT_RETRY_FOR_MS = 24 * 3_600_000;

const UNAVAILABLE = 'Le service de retrait est momentanément indisponible.';

/**
 * Smallest payout per currency. CDF: FlexPaie's own minimum, measured in production (99 refused, 100 accepted).
 * USD: one dollar, the usual Mobile Money floor. Checked BEFORE the wallet is debited.
 */
const PAYOUT_MINIMUM_CENTS: Record<string, number> = { CDF: 100_00, USD: 1_00 };

/** The reference given to FlexPaie for one attempt: short (22 characters at most), new for each attempt. */
export function payoutReference(withdrawalId: string, attempt: number): string {
  return `RET-${withdrawalId.replace(/-/g, '').slice(0, 16).toUpperCase()}-${attempt}`;
}

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
  private readonly logger = new Logger(FlexPaieAdapter.name);
  /** The PayoutService token (from its own login), kept until shortly before it expires. */
  private payoutToken: { value: string; expiresAt: number } | null = null;
  private payoutTokenRequest: Promise<string> | null = null;

  /**
   * Withdrawals go out automatically once FLEXPAIE_PAYOUTS_ENABLED=true AND the PayoutService access is configured.
   * Otherwise they wait for an admin (Administration → Retraits à traiter), as before.
   */
  get supportsPayout(): boolean {
    return this.payoutsEnabled() && this.payoutConfigured();
  }

  /** FlexPaie's PayoutService only sends to Mobile Money: a bank withdrawal still waits for an admin. */
  supportsPayoutChannel(channel: string): boolean {
    return channel === 'mobile_money';
  }

  constructor(private configService: ConfigService, private supabaseService: SupabaseService) {
    if (this.configService.get('NODE_ENV') === 'production') {
      for (const url of [this.paymentUrl(false), this.paymentUrl(true), this.checkUrl()]) {
        if (url.startsWith('http://')) {
          this.logger.warn('A FlexPaie address is plain http: the authorization token travels unencrypted. Ask FlexPaie for an https address.');
          break;
        }
      }
    }
    if (this.payoutsEnabled() && !this.payoutConfigured()) {
      this.logger.error('FLEXPAIE_PAYOUTS_ENABLED is set but the PayoutService access is incomplete (FLEXPAIE_PAYOUT_AUTH_URL, FLEXPAIE_PAYOUT_URL, FLEXPAIE_PAYOUT_USERNAME, FLEXPAIE_PAYOUT_PASSWORD, merchant code): withdrawals stay manual.');
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

  /** One call to FlexPaie with the collecting token. */
  private async call(method: 'GET' | 'POST', url: string, body?: Record<string, unknown>): Promise<any> {
    this.assertConfigured(url);
    return this.send(method, url, body, this.authorization());
  }

  /** One HTTP call to FlexPaie at a full address. Never logs the token or the body. */
  private async send(method: 'GET' | 'POST', url: string, body: Record<string, unknown> | undefined, authorization?: string): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { ...(authorization ? { Authorization: authorization } : {}), 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err: any) {
      // "fetch failed" alone says nothing: the cause (ENOTFOUND = unknown host, ECONNREFUSED, a certificate error, a
      // proxy that does not answer…) and the host (never the path, the token or the body) are what tells them apart.
      const cause = err?.cause?.code || err?.cause?.message || '';
      let host = '';
      try { host = new URL(url).host; } catch { host = 'invalid address'; }
      throw new FlexPaieCallError(
        `FlexPaie unreachable: ${err?.name === 'AbortError' ? 'timeout' : err?.message}${cause ? ` (${String(cause).slice(0, 120)})` : ''} [host: ${host}]`,
        // No connection was ever made: the request certainly did not reach FlexPaie. A timeout is NOT that.
        { neverReached: err?.name !== 'AbortError' && NEVER_REACHED.has(String(err?.cause?.code ?? '')) },
      );
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 || res.status === 403) throw new FlexPaieCallError(`FlexPaie Authentication failed (HTTP ${res.status})`, { refusedToken: true });
    if (!res.ok) throw new FlexPaieCallError(`FlexPaie HTTP ${res.status}`);
    try {
      return await res.json();
    } catch {
      throw new FlexPaieCallError('FlexPaie answered something that is not JSON');
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
      // FlexPaie's refusal message is already French and actionable ("Le
      // montant est inférieur au montant minimal pour le CDF") — pass it to
      // the payer as a 400. Every caller lets BadRequestException through;
      // hiding it behind the generic "service unavailable" made a fixable
      // problem (an amount below their ~100 CDF minimum) look like an outage.
      throw new BadRequestException(String(answer?.message ?? 'Paiement refusé par le fournisseur').slice(0, 200));
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

  // ---------------------------------------------------------------- refunds: not offered by FlexPaie

  async refund(params: RefundParams): Promise<RefundResult> {
    this.logger.warn(`FlexPaie refund requested for ${params.psp_intent_id} — no refund API documented, must be done with FlexPaie`);
    throw new BadRequestException("Le remboursement automatique n'est pas disponible avec FlexPaie — traitez-le avec FlexPaie.");
  }


  // ---------------------------------------------------------------- sending money (PayoutService, v1.03)
  //
  //   POST <auth>   {username, password}                → {code, token: "Bearer …", expire_in}
  //   POST <pay>    {merchant, type "1", reference, amount, currency, customer, description, callback_url}
  //                 → {code, status "0XX0".."0XX5", message, orderNumber}
  //   GET  <check>/<orderNumber>                        → {code, reference, orderNumber, status "0"|"1", …}
  //
  // The journal `flexpaie_payouts` (migration 067) is written BEFORE the request leaves: it is what stops a payout
  // from being sent twice, and what remembers the order number without which FlexPaie cannot be asked anything.

  private payoutsEnabled(): boolean {
    return String(this.configService.get<string>('FLEXPAIE_PAYOUTS_ENABLED', '') ?? '').trim().toLowerCase() === 'true';
  }

  private payoutMerchant(): string {
    return String(this.configService.get<string>('FLEXPAIE_PAYOUT_MERCHANT', '') ?? '').trim() || this.merchant();
  }

  private payoutCheckUrl(): string {
    return this.env('FLEXPAIE_PAYOUT_CHECK_URL').replace(/\/(ORDER[A-Z_]*|orderNumber)$/i, '') || this.checkUrl();
  }

  private payoutConfigured(): boolean {
    return !!(this.env('FLEXPAIE_PAYOUT_AUTH_URL') && this.env('FLEXPAIE_PAYOUT_URL') && this.payoutCheckUrl() && this.payoutMerchant()
      && String(this.configService.get('FLEXPAIE_PAYOUT_USERNAME', '') ?? '').trim()
      && String(this.configService.get('FLEXPAIE_PAYOUT_PASSWORD', '') ?? ''));
  }

  /** The PayoutService token: one login, reused until a minute before it expires. `fresh` forces a new login. */
  private async payoutAuthorization(fresh = false): Promise<string> {
    if (!fresh && this.payoutToken && this.payoutToken.expiresAt > Date.now()) return this.payoutToken.value;
    if (fresh) this.payoutToken = null;
    this.payoutTokenRequest ??= (async () => {
      try {
        const answer = await this.send('POST', this.env('FLEXPAIE_PAYOUT_AUTH_URL'), {
          username: String(this.configService.get('FLEXPAIE_PAYOUT_USERNAME', '') ?? '').trim(),
          password: String(this.configService.get('FLEXPAIE_PAYOUT_PASSWORD', '') ?? ''),
        });
        const token = String(answer?.token ?? '').trim();
        if (String(answer?.code) !== '0' || !token) {
          throw new FlexPaieCallError(`FlexPaie payout login refused: code=${answer?.code} message=${String(answer?.message ?? '').slice(0, 120)}`, { refusedToken: true });
        }
        const seconds = Number(answer?.expire_in);
        const lifetimeMs = Number.isFinite(seconds) && seconds > 0 ? Math.max(seconds - 60, 30) * 1000 : 10 * 60_000;
        const value = /^bearer\s/i.test(token) ? token : `Bearer ${token}`;
        this.payoutToken = { value, expiresAt: Date.now() + lifetimeMs };
        return value;
      } finally {
        this.payoutTokenRequest = null;
      }
    })();
    return this.payoutTokenRequest;
  }

  private async payoutRow(reference: string): Promise<{ reference: string; sent_reference: string | null; order_number: string | null; amount_cents?: number | string | null; currency?: string | null; state: string; attempts: number; created_at: string; updated_at: string } | null> {
    const { data, error } = await this.supabaseService.getClient().from('flexpaie_payouts').select('*').eq('reference', reference).maybeSingle();
    if (error) throw new Error(`Could not read the FlexPaie payout journal: ${error.message}`);
    return data ?? null;
  }

  private async markPayout(reference: string, patch: Record<string, unknown>): Promise<boolean> {
    const { error } = await this.supabaseService.getClient().from('flexpaie_payouts')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('reference', reference);
    if (error) this.logger.error(`Could not update the FlexPaie payout journal for ${reference}: ${error.message}`);
    return !error;
  }

  /**
   * Takes the right to send this withdrawal, before anything leaves. Only one sender can win: the insert (primary key)
   * for a first try, the NOT_SENT → SENDING update for a retry. The loser stops without sending.
   */
  private async claimPayout(reference: string, existing: { state: string; attempts: number } | null, amount: { amount_cents: number; currency: string }): Promise<string> {
    const db = this.supabaseService.getClient();
    if (!existing) {
      const sent = payoutReference(reference, 1);
      const { error } = await db.from('flexpaie_payouts').insert({ reference, sent_reference: sent, state: 'SENDING', amount_cents: amount.amount_cents, currency: amount.currency });
      if (!error) return sent;
      if (/duplicate|unique/i.test(error.message)) throw new Error(`FlexPaie payout ${reference} is already being sent: not sent twice`);
      throw new PayoutNotSentError(UNAVAILABLE, `Journal des retraits FlexPaie inaccessible (migration 067 appliquée ?) : ${error.message}`);
    }
    const sent = payoutReference(reference, existing.attempts + 1);
    const { data, error } = await db.from('flexpaie_payouts')
      .update({ state: 'SENDING', attempts: existing.attempts + 1, sent_reference: sent, updated_at: new Date().toISOString() })
      .eq('reference', reference).eq('state', 'NOT_SENT').select('reference');
    if (error) throw new PayoutRetryLaterError(`Could not claim FlexPaie payout ${reference}: ${error.message}`);
    if (!data || (Array.isArray(data) && data.length === 0)) throw new Error(`FlexPaie payout ${reference} is already being sent: not sent twice`);
    return sent;
  }

  /**
   * What FlexPaie would refuse, said before the wallet is debited (null = fine): only whole amounts, in CDF or USD,
   * from the minimum up. The maximums are the withdrawal limits set in the administration.
   */
  checkPayout(params: { amount_cents: number; currency: string; channel: string }): string | null {
    if (!this.supportsPayout || !this.supportsPayoutChannel(params.channel)) return null;
    const minimum = PAYOUT_MINIMUM_CENTS[params.currency];
    if (minimum === undefined) return 'Le retrait Mobile Money se fait en CDF ou en USD.';
    if (!isWholeCurrencyUnits(params.amount_cents)) return "Le retrait Mobile Money n'accepte que des montants entiers (sans centimes).";
    if (params.amount_cents < minimum) return `Montant minimum pour un retrait Mobile Money : ${(minimum / 100).toLocaleString('fr-FR')} ${params.currency}.`;
    return null;
  }

  async payout(params: PayoutParams): Promise<PayoutResult> {
    if (!this.supportsPayout) {
      throw new PayoutNotSentError("Les retraits automatiques ne sont pas activés : l'envoi d'argent par FlexPaie n'est pas connecté.");
    }
    if (!this.supportsPayoutChannel(params.channel)) throw new PayoutNotSentError("FlexPaie n'envoie de l'argent que vers le Mobile Money.");
    const refused = this.checkPayout(params);
    if (refused) throw new PayoutNotSentError(refused);
    let customer: string;
    try {
      customer = toFlexPaieMsisdn(params.destination?.phone);
    } catch {
      throw new PayoutNotSentError('Numéro Mobile Money invalide.');
    }

    const existing = await this.payoutRow(params.reference);
    if (existing?.state === 'ACCEPTED' && existing.order_number) return { psp_payout_id: existing.order_number, status: 'PENDING' };
    if (existing && existing.state !== 'NOT_SENT') {
      // SENDING: a request may already have left. Sending again could pay twice: it is settled by the check instead.
      throw new Error(`FlexPaie payout ${params.reference} is ${existing.state}: not sent again`);
    }

    // Logging in comes first: if it fails, nothing was claimed and nothing left — the withdrawal is simply tried again.
    let authorization: string;
    try {
      authorization = await this.payoutAuthorization();
    } catch (err: any) {
      if (err instanceof FlexPaieCallError && err.refusedToken) {
        throw new PayoutNotSentError(UNAVAILABLE, `Connexion au PayoutService FlexPaie refusée : vérifiez FLEXPAIE_PAYOUT_USERNAME / FLEXPAIE_PAYOUT_PASSWORD. (${err.message})`);
      }
      throw new PayoutRetryLaterError(`FlexPaie payout login failed: ${err?.message}`);
    }

    const sentReference = await this.claimPayout(params.reference, existing, params);

    const body = {
      merchant: this.payoutMerchant(),
      type: '1',
      reference: sentReference,
      amount: String(params.amount_cents / 100),
      currency: params.currency,
      customer,
      description: `Retrait ScanLinkPay ${sentReference}`,
      callback_url: params.callback_url,
    };

    for (let attempt = 0; ; attempt++) {
      let answer: any;
      try {
        answer = await this.send('POST', this.env('FLEXPAIE_PAYOUT_URL'), body, authorization);
      } catch (err: any) {
        if (err instanceof FlexPaieCallError && err.neverReached) {
          await this.markPayout(params.reference, { state: 'NOT_SENT', last_error: err.message.slice(0, 300) });
          throw new PayoutRetryLaterError(err.message);
        }
        if (err instanceof FlexPaieCallError && err.refusedToken) {
          if (attempt === 0) {
            authorization = await this.payoutAuthorization(true).catch(() => authorization);
            continue;
          }
          await this.markPayout(params.reference, { state: 'NOT_SENT', last_error: err.message.slice(0, 300) });
          throw new PayoutNotSentError(UNAVAILABLE, `FlexPaie refuse le jeton du PayoutService (${err.message}).`);
        }
        // Timeout, 5xx, garbled answer: the money MAY have left. Stays SENDING; the callback or the check settles it.
        await this.markPayout(params.reference, { last_error: String(err?.message).slice(0, 300) });
        throw err;
      }

      const code = String(answer?.code ?? '').trim();
      // The documentation writes the statuses "0XX0".."0XX5" (and once "OXX0", with a letter O): only the last digit counts.
      const outcome = String(answer?.status ?? '').trim().slice(-1);
      const message = String(answer?.message ?? '').slice(0, 200);
      const orderNumber = answer?.orderNumber ? String(answer.orderNumber) : '';

      if (code === '0' && (outcome === '0' || outcome === '') && orderNumber) {
        let saved = false;
        for (let i = 0; i < 3 && !saved; i++) saved = await this.markPayout(params.reference, { state: 'ACCEPTED', order_number: orderNumber, last_error: null });
        // Even if the journal could not be written, the order number travels back and is stored on the withdrawal.
        return { psp_payout_id: orderNumber, status: 'PENDING' };
      }

      if (outcome === '4' && attempt === 0) {
        authorization = await this.payoutAuthorization(true).catch(() => authorization);
        continue;
      }

      if (code !== '1' && !['1', '2', '3', '4', '5'].includes(outcome)) {
        // Neither an acceptance we can follow nor a refusal: treat like a lost answer.
        await this.markPayout(params.reference, { last_error: `unexpected answer code=${code} status=${answer?.status}`.slice(0, 300) });
        throw new Error(`FlexPaie payout ${params.reference}: unexpected answer code=${code} status=${answer?.status}`);
      }

      await this.markPayout(params.reference, { state: 'NOT_SENT', last_error: `${answer?.status ?? code}: ${message}`.slice(0, 300) });
      this.logger.warn(`FlexPaie refused payout ${params.reference}: code=${code} status=${answer?.status} message=${message}`);
      switch (outcome) {
        case '1':
          throw new PayoutRetryLaterError(`FlexPaie is busy with another payout: ${message}`);
        case '2':
          throw new PayoutNotSentError(UNAVAILABLE, `Solde FlexPaie insuffisant pour un retrait de ${body.amount} ${body.currency} : approvisionnez le compte marchand FlexPaie.`);
        case '3':
          throw new PayoutNotSentError("Ce numéro Mobile Money n'est pas pris en charge par le service de retrait. Vérifiez le numéro et l'opérateur.");
        case '4':
          throw new PayoutNotSentError(UNAVAILABLE, `FlexPaie refuse le jeton du PayoutService (${message}).`);
        default:
          throw new PayoutNotSentError(message || "Le retrait a été refusé par le service de paiement.");
      }
    }
  }

  /** Asks FlexPaie about one payout, with the PayoutService token. Null when they know no such order. */
  private async payoutCheck(orderNumber: string): Promise<any | null> {
    const url = `${this.payoutCheckUrl()}/${encodeURIComponent(orderNumber)}`;
    let answer: any;
    try {
      answer = await this.send('GET', url, undefined, await this.payoutAuthorization());
    } catch (err: any) {
      if (!(err instanceof FlexPaieCallError && err.refusedToken)) throw err;
      try {
        answer = await this.send('GET', url, undefined, await this.payoutAuthorization(true));
      } catch (again: any) {
        // The documentation names "the authorization token" without saying which: the check service is the one that
        // answers for payments, so the collecting token is tried last.
        const collecting = String(this.configService.get('FLEXPAIE_TOKEN', '') ?? '').trim();
        if (!(again instanceof FlexPaieCallError && again.refusedToken) || !collecting) throw again;
        answer = await this.send('GET', url, undefined, this.authorization());
      }
    }
    const t = answer?.transaction ?? answer;
    return t && t.status !== undefined && t.status !== null && String(t.status) !== '' ? t : null;
  }

  async getPayoutStatus(reference: string, hint?: { psp_reference?: string | null }): Promise<PayoutStatusResult> {
    const row = await this.payoutRow(reference);
    // Never handed to FlexPaie (a withdrawal from the manual period, or a request that died before sending): send it.
    if (!row) return { status: 'NOT_SENT' };

    if (row.state === 'NOT_SENT') {
      if (Date.now() - new Date(row.created_at).getTime() > PAYOUT_RETRY_FOR_MS) {
        return { status: 'FAILED', failure_reason: "Le retrait n'a pas pu être envoyé : le service de paiement est resté indisponible. Votre argent a été remis dans votre portefeuille." };
      }
      return { status: 'NOT_SENT' };
    }

    const orderNumber = row.order_number || hint?.psp_reference || '';
    if (!orderNumber) {
      if (row.state === 'ABANDONED' || (row.state === 'SENDING' && Date.now() - new Date(row.updated_at).getTime() > PAYOUT_NO_NEWS_MS)) {
        if (row.state !== 'ABANDONED') {
          this.logger.warn(`FlexPaie payout ${reference}: no answer and no callback for 30 minutes — taken as never sent, refunded`);
          await this.markPayout(reference, { state: 'ABANDONED' });
        }
        return { status: 'FAILED', failure_reason: "Le retrait n'a pas pu être confirmé par le service de paiement. Votre argent a été remis dans votre portefeuille." };
      }
      return { status: 'PENDING' };
    }
    if (!row.order_number) await this.markPayout(reference, { order_number: orderNumber, ...(row.state === 'SENDING' ? { state: 'ACCEPTED' } : {}) });

    const t = await this.payoutCheck(orderNumber);
    if (!t) {
      this.logger.warn(`FlexPaie payout ${reference}: order ${orderNumber} not found (yet) by the check`);
      return { status: 'PENDING', psp_payout_id: orderNumber };
    }
    if (t.reference && !this.isOurs(row, String(t.reference))) {
      this.logger.error(`FlexPaie payout ${reference}: order ${orderNumber} carries another reference (${t.reference}) — ignored`);
      return { status: 'PENDING', psp_payout_id: orderNumber };
    }
    // The same check service as for payments (same address in both documentations): the same status codes —
    // 0 done, 2 still in progress, 1/3/4/5 not done; anything else keeps waiting, never a verdict.
    const status = mapFlexPaieStatus(t.status);
    if (status === 'SUCCESS') return { status: 'SUCCESS', psp_payout_id: orderNumber };
    if (status === 'FAILED') return { status: 'FAILED', psp_payout_id: orderNumber, failure_reason: "L'envoi vers votre numéro Mobile Money a échoué. Votre argent a été remis dans votre portefeuille." };
    return { status: 'PENDING', psp_payout_id: orderNumber };
  }

  async payoutsInFlight(references: string[]): Promise<Set<string>> {
    if (references.length === 0) return new Set();
    const { data, error } = await this.supabaseService.getClient().from('flexpaie_payouts')
      .select('reference').in('reference', references).in('state', ['SENDING', 'ACCEPTED']);
    // No journal yet (migration 067 not applied): nothing was ever handed to FlexPaie, so nothing is in flight.
    if (error && /flexpaie_payouts/i.test(String(error.message)) && /does not exist|schema cache/i.test(String(error.message))) {
      return new Set();
    }
    // Any other unknown is treated as "in flight": better a withdrawal hidden from the admin page for a while than paid twice.
    if (error) {
      this.logger.error(`Could not read the FlexPaie payout journal: ${error.message}`);
      return new Set(references);
    }
    return new Set((data || []).map((r: any) => r.reference));
  }

  /** A reference FlexPaie reports for this withdrawal: the one sent for an attempt, or the withdrawal id itself. */
  private isOurs(row: { reference: string; sent_reference: string | null }, reported: string): boolean {
    return reported === row.sent_reference || reported === row.reference;
  }

  /** The journal row a reference reported by FlexPaie belongs to (the attempt's reference, or the withdrawal id). */
  private async payoutRowByReported(reported: string) {
    const { data, error } = await this.supabaseService.getClient().from('flexpaie_payouts').select('*').eq('sent_reference', reported).maybeSingle();
    if (error) throw new Error(`Could not read the FlexPaie payout journal: ${error.message}`);
    return data ?? (await this.payoutRow(reported));
  }

  /**
   * FlexPaie's payout callback: unsigned, so only a hint. Its one useful content is the order number when our own
   * request lost its answer — recorded only after FlexPaie's check confirms that order carries OUR reference.
   */
  async acceptPayoutCallback(payload: Buffer): Promise<string | null> {
    const body = this.parseCallback(payload);
    const reported = typeof body?.reference === 'string' ? body.reference.trim() : '';
    if (!reported || reported.length > 100) return null;
    const row = await this.payoutRowByReported(reported);
    if (!row) return null;
    const reference = row.reference;

    const claimed = body?.orderNumber ? String(body.orderNumber).trim() : '';
    if (row.order_number) {
      if (claimed && claimed !== row.order_number) {
        this.logger.warn(`FlexPaie payout callback for ${reference} names order ${claimed}, recorded ${row.order_number} — refused`);
        return null;
      }
      return reference;
    }
    if (!claimed || claimed.length > 100) return reference;

    const t = await this.payoutCheck(claimed);
    if (!t || !this.isOurs(row, String(t.reference ?? ''))) {
      this.logger.warn(`FlexPaie payout callback for ${reference}: order ${claimed} is unknown or not ours — refused`);
      return null;
    }
    // Same reference is not enough: the order must also be for the amount and currency we sent.
    const sameAmount = t.amount === undefined || t.amount === null || row.amount_cents == null || toCents(t.amount) === Number(row.amount_cents);
    const sameCurrency = !t.currency || !row.currency || String(t.currency).toUpperCase() === String(row.currency).toUpperCase();
    if (!sameAmount || !sameCurrency) {
      this.logger.error(`FlexPaie payout callback for ${reference}: order ${claimed} is for ${t.amount} ${t.currency}, not what we sent — refused`);
      return null;
    }
    await this.markPayout(reference, { order_number: claimed, ...(row.state === 'ABANDONED' ? {} : { state: 'ACCEPTED' }) });
    return reference;
  }
}
