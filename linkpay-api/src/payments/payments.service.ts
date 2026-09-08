import { Injectable, Logger, BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { PspFactory } from './psp/psp.factory';
import { CommissionsService } from '../commissions/commissions.service';
import { LedgerService } from '../ledger/ledger.service';
import { TransactionsService } from '../transactions/transactions.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentRequestsService } from '../payment-requests/payment-requests.service';
import { WalletPinService } from '../wallets/wallet-pin.service';
import { WalletLimitsService } from '../wallets/wallet-limits.service';
import { AuditService } from '../audit/audit.service';
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
    private walletPinService: WalletPinService,
    private walletLimitsService: WalletLimitsService,
    private auditService: AuditService,
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

    // Idempotency check first — a replay must return the original result
    // even once the request has since moved to PAID as a consequence of
    // that very call, not a confusing "already paid" error (see the mirror
    // fix in payWithWallet() for the wallet-based flow below).
    const { data: existing } = await this.supabaseService.getClient()
      .from('payment_intents')
      .select('id, status, psp_intent_id')
      .eq('idempotency_key', data.idempotency_key)
      .single();

    if (existing) {
      return {
        payment_intent_id: existing.id,
        psp_intent_id: existing.psp_intent_id,
        status: existing.status,
        message: 'Payment intent already exists (idempotent)',
      };
    }

    if (request.status === 'PAID') {
      throw new BadRequestException('Payment request already paid');
    }

    if (request.expires_at && new Date(request.expires_at) < new Date()) {
      throw new BadRequestException('Payment request has expired');
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

    let pspResult;
    try {
      pspResult = await adapter.createPaymentIntent({
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
    } catch (err: any) {
      this.logger.error(`PSP payment init failed: ${err.message}`, err.stack);
      if (err.message?.includes('not withlisted') || err.message?.includes('Authentication failed')) {
        throw new ServiceUnavailableException('Le service de paiement est temporairement indisponible. Veuillez réessayer plus tard.');
      }
      if (err.message?.includes('phone') || err.message?.includes('PhoneNumber') || err.message?.includes('international format')) {
        throw new BadRequestException('Numéro de téléphone invalide. Utilisez le format international (ex: +243XXXXXXXXX).');
      }
      throw new ServiceUnavailableException('Impossible d\'initialiser le paiement. Veuillez réessayer ou contacter le support.');
    }

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

  /**
   * Pays an existing payment request (invoice) out of the payer's LinkPay
   * wallet — the authenticated, in-app counterpart to createPayment() above
   * (which is for anonymous customers checking out via PSP/Mobile Money).
   * Deliberately reuses payment_intents/handleSuccessfulPayment instead of a
   * parallel pipeline: same idempotency table, same transaction/ledger/
   * receipt/notification writes, same "payment_requests.markPaid" — only the
   * settlement mechanism differs (a synchronous wallet debit here instead of
   * an async PSP + webhook).
   */
  async payWithWallet(userId: string, linkToken: string, pin: string, idempotencyKey: string) {
    const { data: request, error } = await this.supabaseService.getClient()
      .from('payment_requests')
      .select('*')
      .eq('link_token', linkToken)
      .single();

    if (error || !request) {
      throw new NotFoundException('Facture introuvable');
    }

    // Idempotency check comes BEFORE any status guard: a replay of the same
    // Idempotency-Key must always return the original result, even once the
    // request has since moved to PAID as a direct consequence of that first
    // call — otherwise a retried request (e.g. after a dropped response)
    // would see a confusing "already paid" error instead of its own result.
    const { data: existing } = await this.supabaseService.getClient()
      .from('payment_intents')
      .select('id, status')
      .eq('idempotency_key', idempotencyKey)
      .single();

    if (existing) {
      return { payment_intent_id: existing.id, status: existing.status, message: 'Payment intent already exists (idempotent)' };
    }

    if (request.status === 'PAID') {
      throw new BadRequestException('Cette facture a déjà été payée');
    }
    if (request.status === 'CANCELLED') {
      throw new BadRequestException('Cette facture a été annulée');
    }
    if (request.expires_at && new Date(request.expires_at) < new Date()) {
      throw new BadRequestException('Cette facture a expiré');
    }

    const { data: payerWallet } = await this.supabaseService.getClient()
      .from('wallets')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!payerWallet) {
      throw new NotFoundException('Wallet introuvable');
    }
    if (payerWallet.status !== 'ACTIVE') {
      throw new BadRequestException(`Votre wallet est ${payerWallet.status}, paiement impossible`);
    }

    // PIN verified before anything is created/debited — never trust the
    // frontend's "user confirmed" state for a financial operation.
    await this.walletPinService.verifyPin(userId, pin);

    const fees = await this.commissionsService.calculateFeesPreview(
      request.amount_cents,
      request.currency,
      request.merchant_id,
      request.commission_model,
    );

    const rule = await this.walletLimitsService.getRule('WALLET_PAYMENT', request.currency);
    await this.walletLimitsService.assertWithinLimits(payerWallet.id, 'WALLET_PAYMENT', fees.total_cents, rule);

    const pspIntentId = `WALLET-${uuidv4()}`;

    const { data: intent, error: intentError } = await this.supabaseService.getClient()
      .from('payment_intents')
      .insert({
        payment_request_id: request.id,
        client_id: userId,
        amount_cents: request.amount_cents,
        currency: request.currency,
        fees_cents: fees.total_fees_cents,
        total_cents: fees.total_cents,
        psp_intent_id: pspIntentId,
        psp_provider: 'wallet',
        idempotency_key: idempotencyKey,
        status: 'PENDING',
        psp_response: { payment_method: 'wallet' },
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

    const { error: debitError } = await this.supabaseService.getClient().rpc('debit_wallet', {
      p_wallet_id: payerWallet.id,
      p_amount_cents: fees.total_cents,
      p_entry_type: 'PAYMENT',
      p_reference: request.reference,
      p_currency: request.currency,
      p_metadata: { payment_request_id: request.id, payment_intent_id: intent.id },
    });

    if (debitError) {
      await this.supabaseService.getClient().from('payment_intents').update({ status: 'FAILED', updated_at: new Date().toISOString() }).eq('id', intent.id);
      await this.supabaseService.getClient().from('payment_requests').update({ status: 'CREATED', updated_at: new Date().toISOString() }).eq('id', request.id);
      throw new BadRequestException('Solde LinkPay insuffisant pour ce paiement.');
    }

    try {
      const transaction = await this.handleSuccessfulPayment(intent, { psp_intent_id: pspIntentId });

      await this.auditService.log({
        user_id: userId,
        action: 'wallet_payment',
        entity_type: 'payment_intent',
        entity_id: intent.id,
        changes: { amount_cents: request.amount_cents, merchant_id: request.merchant_id, reference: request.reference },
      });

      return { payment_intent_id: intent.id, status: 'SUCCESS', reference: transaction?.reference };
    } catch (err: any) {
      // The wallet was already debited but the transaction/ledger pipeline
      // failed downstream — never leave the customer's money in limbo:
      // reverse the debit and fail the whole operation cleanly.
      this.logger.error(`Wallet payment debit succeeded but finalize failed for intent ${intent.id}, reversing: ${err.message}`);
      await this.supabaseService.getClient().rpc('credit_wallet', {
        p_wallet_id: payerWallet.id,
        p_amount_cents: fees.total_cents,
        p_entry_type: 'ADJUSTMENT',
        p_reference: `REVERSAL-${request.reference}`,
        p_currency: request.currency,
        p_metadata: { payment_intent_id: intent.id, reason: 'finalize_failed' },
      });
      await this.supabaseService.getClient().from('payment_intents').update({ status: 'FAILED', updated_at: new Date().toISOString() }).eq('id', intent.id);
      throw new BadRequestException('Le paiement a échoué. Aucun montant n\'a été débité.');
    }
  }

  async processWebhook(provider: string, payload: Buffer, signature: string, headers: Record<string, string>) {
    const adapter = this.pspFactory.get(provider);

    if (!adapter.verifyWebhook(payload, signature, headers)) {
      this.logger.warn(`Webhook signature verification failed for provider: ${provider}`);
      throw new BadRequestException('Invalid webhook signature');
    }

    const event = await adapter.parseWebhookEvent(payload, headers);
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
      // Not a merchant payment webhook — could be a wallet top-up instead.
      // Kept as a direct table lookup here (rather than injecting
      // WalletsService) to avoid a circular module dependency, since
      // WalletsModule already depends on PaymentsModule for PspFactory.
      const handledAsTopup = await this.tryHandleTopupWebhook(event.psp_intent_id, event.status);
      if (handledAsTopup) {
        await this.markWebhookProcessed(dedupHash);
        return { status: 'processed', event_type: event.event_type };
      }

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

  /** Returns true if a wallet_topups row was found for this psp_intent_id (handled either way). */
  private async tryHandleTopupWebhook(pspIntentId: string, status: string): Promise<boolean> {
    const { data: topup } = await this.supabaseService.getClient()
      .from('wallet_topups')
      .select('*')
      .eq('psp_intent_id', pspIntentId)
      .single();

    if (!topup) {
      return false;
    }

    if (status === 'SUCCESS') {
      if (topup.status !== 'SUCCESS') {
        const { error: rpcError } = await this.supabaseService.getClient().rpc('credit_wallet', {
          p_wallet_id: topup.wallet_id,
          p_amount_cents: topup.amount_cents,
          p_entry_type: 'TOPUP',
          p_reference: `TOPUP-${topup.id}`,
          p_currency: topup.currency,
          p_metadata: { wallet_topup_id: topup.id, psp_intent_id: pspIntentId },
        });

        if (rpcError) {
          this.logger.error(`Failed to credit wallet for top-up ${topup.id}: ${rpcError.message}`);
          return true;
        }

        await this.supabaseService.getClient()
          .from('wallet_topups')
          .update({ status: 'SUCCESS', updated_at: new Date().toISOString() })
          .eq('id', topup.id);

        const { data: wallet } = await this.supabaseService.getClient()
          .from('wallets')
          .select('user_id')
          .eq('id', topup.wallet_id)
          .single();

        if (wallet?.user_id) {
          await this.notificationsService.create({
            user_id: wallet.user_id,
            type: 'wallet_topup_success',
            title: 'Portefeuille rechargé',
            body: `Votre compte LinkPay a été crédité de ${(topup.amount_cents / 100).toLocaleString('fr-FR')} ${topup.currency}.`,
            data: { wallet_topup_id: topup.id },
          }).catch(() => null);
        }

        this.logger.log(`Wallet top-up ${topup.id} confirmed via webhook, wallet ${topup.wallet_id} credited`);
      }
    } else if (status === 'FAILED') {
      await this.supabaseService.getClient()
        .from('wallet_topups')
        .update({ status: 'FAILED', updated_at: new Date().toISOString() })
        .eq('id', topup.id);
    }

    return true;
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
