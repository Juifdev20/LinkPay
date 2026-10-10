export interface CreatePaymentIntentParams {
  amount_cents: number;
  currency: string;
  reference: string;
  customer?: {
    email?: string;
    phone?: string;
    name?: string;
  };
  redirect_url: string;
  webhook_url: string;
  metadata?: Record<string, any>;
}

export interface PaymentIntentResult {
  psp_intent_id: string;
  checkout_url?: string;
  client_secret?: string;
  status: string;
}

export interface WebhookEventResult {
  event_id: string;
  event_type: string;
  psp_intent_id: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  amount_cents: number;
  currency: string;
  reference: string;
  raw: Record<string, any>;
}

export interface RefundParams {
  psp_intent_id: string;
  amount_cents: number;
  reason?: string;
}

export interface RefundResult {
  psp_refund_id: string;
  status: string;
}

export interface TransactionStatusResult {
  status: string;
  amount_cents: number;
  currency: string;
}

export interface PayoutParams {
  /** Our own id for this payout (the withdrawal's id) — the provider echoes
   * it back, so a status query by reference can always tell us whether the
   * payout happened, even if the answer to the original call was lost. */
  reference: string;
  amount_cents: number;
  currency: string;
  channel: 'mobile_money' | 'bank';
  /** {operator, phone} for mobile money, {bank, account_number, account_name} for a bank. */
  destination: Record<string, any>;
  callback_url?: string;
}

export interface PayoutResult {
  psp_payout_id: string;
  status: 'SUCCESS' | 'PENDING' | 'FAILED';
  failure_reason?: string;
}

export interface PayoutStatusResult {
  /** NOT_FOUND: the provider has no payout with this reference — it was never sent. */
  status: 'SUCCESS' | 'PENDING' | 'FAILED' | 'NOT_FOUND';
  psp_payout_id?: string;
  failure_reason?: string;
}

/**
 * Thrown by payout() ONLY when the provider certainly did not send the money
 * (unsupported, invalid request, refused up front). Any other error — a
 * timeout, a dropped connection, a 5xx — is ambiguous: the money may have
 * left, so the withdrawal stays open and is settled later by asking the
 * provider (getPayoutStatus). Refunding on an ambiguous error would pay the
 * merchant twice.
 */
export class PayoutNotSentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayoutNotSentError';
  }
}

export interface PspAdapter {
  readonly provider: string;
  /**
   * false when the provider has NO API to send money out (FlexPaie, for now). Withdrawals then wait for an admin to
   * send the money by hand and mark it done (ManualWithdrawalsService); nothing is sent to the provider and the
   * reconciliation never concludes anything about them. Left out = payouts are supported.
   */
  readonly supportsPayout?: boolean;

  createPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntentResult>;
  verifyWebhook(payload: Buffer, signature: string, headers: Record<string, string>): boolean;
  parseWebhookEvent(payload: Buffer, headers: Record<string, string>): Promise<WebhookEventResult>;
  refund(params: RefundParams): Promise<RefundResult>;
  getTransactionStatus(psp_intent_id: string): Promise<TransactionStatusResult>;

  /** Sends money out (a wallet withdrawal) to a Mobile Money number or bank account. */
  payout(params: PayoutParams): Promise<PayoutResult>;
  getPayoutStatus(reference: string): Promise<PayoutStatusResult>;
}
