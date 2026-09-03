import { Injectable, Logger, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { PspFactory } from './psp/psp.factory';
import { CommissionsService } from '../commissions/commissions.service';
import { LedgerService } from '../ledger/ledger.service';
import { TransactionsService } from '../transactions/transactions.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentRequestsService } from '../payment-requests/payment-requests.service';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private supabaseService: SupabaseService,
    private pspFactory: PspFactory,
    private commissionsService: CommissionsService,
    private ledgerService: LedgerService,
    private transactionsService: TransactionsService,
    private notificationsService: NotificationsService,
    private paymentRequestsService: PaymentRequestsService,
    private configService: ConfigService,
  ) {}

  async createPayment(data: {
    link_token: string;
    client_id?: string;
    idempotency_key: string;
    payment_method?: string;
    mobile_money_operator?: string;
    customer?: { email?: string; phone?: string; name?: string };
  }) {
    const { data: request, error } = await this.supabaseService.getClient()
      .from('payment_requests')
      .select('*')
      .eq('link_token', data.link_token)
      .single();

    if (error || !request) {
      throw new NotFoundException('Payment request not found');
    }

    if (request.status === 'PAID') {
      throw new BadRequestException('Payment request already paid');
    }

    if (request.expires_at && new Date(request.expires_at) < new Date()) {
      throw new BadRequestException('Payment request has expired');
    }

    const { data: existing } = await this.supabaseService.getClient()
      .from('payment_intents')
      .select('id, status, psp_intent_id')
      .eq('idempotency_key', data.idempotency_key)
      .single();

    if (existing) {
      const adapter = this.pspFactory.get(request.psp_provider || undefined);
      return {
        payment_intent_id: existing.id,
        psp_intent_id: existing.psp_intent_id,
        status: existing.status,
        message: 'Payment intent already exists (idempotent)',
      };
    }

    const fees = await this.commissionsService.calculateFeesPreview(
      request.amount_cents,
      request.currency,
      request.merchant_id,
      request.commission_model,
    );

    const adapter = this.pspFactory.get();
    const provider = adapter.provider;

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:5173');
    const backendUrl = `http://localhost:${this.configService.get<number>('PORT', 3000)}`;

    const pspResult = await adapter.createPaymentIntent({
      amount_cents: fees.total_cents,
      currency: request.currency,
      reference: request.reference,
      customer: data.customer,
      redirect_url: `${frontendUrl}/payment/result?ref=${request.reference}`,
      webhook_url: `${backendUrl}/api/v1/webhooks/${provider}`,
      metadata: {
        payment_request_id: request.id,
        merchant_id: request.merchant_id,
        commission_model: request.commission_model,
      },
    });

    const { data: intent, error: intentError } = await this.supabaseService.getClient()
      .from('payment_intents')
      .insert({
        payment_request_id: request.id,
        client_id: data.client_id || null,
        amount_cents: request.amount_cents,
        currency: request.currency,
        fees_cents: fees.total_fees_cents,
        total_cents: fees.total_cents,
        psp_intent_id: pspResult.psp_intent_id,
        psp_provider: provider,
        idempotency_key: data.idempotency_key,
        status: 'PENDING',
        psp_response: {
          checkout_url: pspResult.checkout_url,
          payment_method: data.payment_method,
          mobile_money_operator: data.mobile_money_operator,
        },
      })
      .select()
      .single();

    if (intentError) {
      throw new Error(`Failed to create payment intent: ${intentError.message}`);
    }

    await this.supabaseService.getClient()
      .from('payment_requests')
      .update({ status: 'PENDING', updated_at: new Date().toISOString() })
      .eq('id', request.id);

    // The mock PSP has no real checkout page or webhook delivery mechanism —
    // simulate a successful payment instead of leaving the intent stuck
    // PENDING forever (see README: "PSP mock: succès automatique"). A short
    // artificial delay stands in for the real round trip of a mobile money
    // STK/USSD push, where the customer confirms with their PIN on their own
    // phone before the provider calls our webhook.
    if (provider === 'mock') {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const transaction = await this.handleSuccessfulPayment(intent, { psp_intent_id: pspResult.psp_intent_id });
      return {
        payment_intent_id: intent.id,
        psp_intent_id: pspResult.psp_intent_id,
        status: 'SUCCESS',
        reference: transaction?.reference,
      };
    }

    return {
      payment_intent_id: intent.id,
      psp_intent_id: pspResult.psp_intent_id,
      checkout_url: pspResult.checkout_url,
      status: pspResult.status,
    };
  }

  async processWebhook(provider: string, payload: Buffer, signature: string, headers: Record<string, string>) {
    const adapter = this.pspFactory.get(provider);

    if (!adapter.verifyWebhook(payload, signature, headers)) {
      this.logger.warn(`Webhook signature verification failed for provider: ${provider}`);
      throw new BadRequestException('Invalid webhook signature');
    }

    const event = adapter.parseWebhookEvent(payload, headers);
    const dedupHash = this.computeDedupHash(provider, event.event_id, event.psp_intent_id);

    const { data: existingEvent } = await this.supabaseService.getClient()
      .from('webhook_events')
      .select('id, processed')
      .eq('dedup_hash', dedupHash)
      .single();

    if (existingEvent) {
      this.logger.log(`Duplicate webhook detected: ${dedupHash}`);
      return { status: 'duplicate', message: 'Webhook already processed' };
    }

    const { error: logError } = await this.supabaseService.getClient()
      .from('webhook_events')
      .insert({
        provider,
        event_id: event.event_id,
        event_type: event.event_type,
        payload: event.raw,
        signature,
        dedup_hash: dedupHash,
        processed: false,
      });

    if (logError) {
      this.logger.error(`Failed to log webhook event: ${logError.message}`);
    }

    const { data: intent } = await this.supabaseService.getClient()
      .from('payment_intents')
      .select('*')
      .eq('psp_intent_id', event.psp_intent_id)
      .single();

    if (!intent) {
      this.logger.warn(`No payment intent found for psp_intent_id: ${event.psp_intent_id}`);
      await this.markWebhookProcessed(dedupHash, 'no_intent_found');
      return { status: 'no_intent' };
    }

    if (event.status === 'SUCCESS') {
      await this.handleSuccessfulPayment(intent, event);
    } else if (event.status === 'FAILED') {
      await this.handleFailedPayment(intent, event);
    } else {
      this.logger.log(`Webhook event ${event.event_type} — status ${event.status}, no action needed`);
    }

    await this.markWebhookProcessed(dedupHash);
    return { status: 'processed', event_type: event.event_type };
  }

  private async handleSuccessfulPayment(intent: any, event: any): Promise<any> {
    const { data: request } = await this.supabaseService.getClient()
      .from('payment_requests')
      .select('*, merchant:merchants(*)')
      .eq('id', intent.payment_request_id)
      .single();

    if (!request) {
      this.logger.error(`No payment request found for intent ${intent.id}`);
      return undefined;
    }

    const commissionResult = await this.commissionsService.calculateFees(
      intent.amount_cents,
      intent.currency,
      request.merchant_id,
      request.commission_model,
    );

    const txReference = `TX-${request.reference}`;

    const { data: transaction, error: txError } = await this.supabaseService.getClient()
      .from('transactions')
      .insert({
        payment_intent_id: intent.id,
        merchant_id: request.merchant_id,
        client_id: intent.client_id,
        amount_cents: intent.amount_cents,
        psp_fee_cents: commissionResult.psp_fee_cents,
        platform_fee_cents: commissionResult.platform_fee_cents,
        other_fees_cents: 0,
        net_cents: commissionResult.net_cents,
        currency: intent.currency,
        status: 'SUCCESS',
        reference: txReference,
        psp_reference: event.psp_intent_id,
        commission_rule_id: commissionResult.commission_rule_id,
        commission_model: request.commission_model,
      })
      .select()
      .single();

    if (txError) {
      this.logger.error(`Failed to create transaction: ${txError.message}`);
      return undefined;
    }

    await this.ledgerService.writePaymentEntries(transaction);

    await this.supabaseService.getClient()
      .from('payment_intents')
      .update({ status: 'SUCCEEDED', updated_at: new Date().toISOString() })
      .eq('id', intent.id);

    await this.paymentRequestsService.markPaid(request.id);

    await this.generateReceipt(transaction, request.merchant);

    if (intent.client_id) {
      await this.notificationsService.create({
        user_id: intent.client_id,
        type: 'payment_success',
        title: 'Paiement réussi',
        body: `Votre paiement de ${intent.amount_cents / 100} ${intent.currency} à ${request.merchant?.name} a été effectué avec succès.`,
        data: { transaction_id: transaction.id, reference: txReference },
      });
    }

    await this.notificationsService.create({
      user_id: request.merchant_id ? (await this.getMerchantOwnerId(request.merchant_id)) : null,
      type: 'payment_received',
      title: 'Paiement reçu',
      body: `Un paiement de ${intent.amount_cents / 100} ${intent.currency} a été reçu (Réf: ${txReference}).`,
      data: { transaction_id: transaction.id, reference: txReference },
    }).catch(() => null);

    this.logger.log(`Payment succeeded: ${txReference}`);
    return transaction;
  }

  private async handleFailedPayment(intent: any, event: any) {
    await this.supabaseService.getClient()
      .from('payment_intents')
      .update({ status: 'FAILED', updated_at: new Date().toISOString() })
      .eq('id', intent.id);

    const { data: request } = await this.supabaseService.getClient()
      .from('payment_requests')
      .select('status')
      .eq('id', intent.payment_request_id)
      .single();

    if (request && request.status === 'PENDING') {
      await this.supabaseService.getClient()
        .from('payment_requests')
        .update({ status: 'CREATED', updated_at: new Date().toISOString() })
        .eq('id', intent.payment_request_id);
    }

    if (intent.client_id) {
      await this.notificationsService.create({
        user_id: intent.client_id,
        type: 'payment_failed',
        title: 'Paiement échoué',
        body: `Votre paiement de ${intent.amount_cents / 100} ${intent.currency} a échoué. Veuillez réessayer.`,
        data: { psp_intent_id: event.psp_intent_id },
      }).catch(() => null);
    }

    this.logger.log(`Payment failed for intent ${intent.id}`);
  }

  private async generateReceipt(transaction: any, merchant: any) {
    const receiptPayload = {
      logo_url: null,
      reference: transaction.reference,
      amount_cents: transaction.amount_cents,
      currency: transaction.currency,
      merchant_name: merchant?.name,
      merchant_phone: merchant?.phone,
      date: transaction.created_at,
      status: transaction.status,
      psp_fee_cents: transaction.psp_fee_cents,
      platform_fee_cents: transaction.platform_fee_cents,
      net_cents: transaction.net_cents,
    };

    await this.supabaseService.getClient()
      .from('receipts')
      .insert({
        transaction_id: transaction.id,
        payload: receiptPayload,
      });
  }

  private async getMerchantOwnerId(merchantId: string): Promise<string | null> {
    const { data } = await this.supabaseService.getClient()
      .from('merchants')
      .select('owner_id')
      .eq('id', merchantId)
      .single();
    return data?.owner_id || null;
  }

  private async markWebhookProcessed(dedupHash: string, error?: string) {
    await this.supabaseService.getClient()
      .from('webhook_events')
      .update({
        processed: true,
        processed_at: new Date().toISOString(),
        error: error || null,
      })
      .eq('dedup_hash', dedupHash);
  }

  private computeDedupHash(provider: string, eventId: string, pspIntentId: string): string {
    return createHash('sha256')
      .update(`${provider}:${eventId}:${pspIntentId}`)
      .digest('hex');
  }
}
