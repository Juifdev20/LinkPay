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

export interface PspAdapter {
  readonly provider: string;

  createPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntentResult>;
  verifyWebhook(payload: Buffer, signature: string, headers: Record<string, string>): boolean;
  parseWebhookEvent(payload: Buffer, headers: Record<string, string>): Promise<WebhookEventResult>;
  refund(params: RefundParams): Promise<RefundResult>;
  getTransactionStatus(psp_intent_id: string): Promise<TransactionStatusResult>;
}
