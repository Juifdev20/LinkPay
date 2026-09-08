import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { SupabaseService } from '../supabase/supabase.service';
import { PspFactory } from '../payments/psp/psp.factory';
import { NotificationsService } from '../notifications/notifications.service';
import { WalletPinService } from './wallet-pin.service';
import { WalletLimitsService } from './wallet-limits.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(
    private supabaseService: SupabaseService,
    private pspFactory: PspFactory,
    private notificationsService: NotificationsService,
    private configService: ConfigService,
    private walletPinService: WalletPinService,
    private walletLimitsService: WalletLimitsService,
    private auditService: AuditService,
  ) {}

  async getWalletByUserId(userId: string) {
    const { data, error } = await this.supabaseService.getClient()
      .from('wallets')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      throw new NotFoundException('Wallet not found');
    }

    return data;
  }

  /**
   * Balances are fully independent per currency — no automatic conversion
   * anywhere. One query over ledger_entries (which already carries its own
   * `currency` per row), reduced client-side into {CDF, USD} — no separate
   * wallet_balances table needed.
   */
  async getBalances(walletId: string): Promise<{ CDF: number; USD: number }> {
    const { data, error } = await this.supabaseService.getClient()
      .from('ledger_entries')
      .select('amount_cents, direction, currency')
      .eq('wallet_id', walletId);

    if (error) {
      throw new Error(`Failed to compute wallet balance: ${error.message}`);
    }

    const balances = { CDF: 0, USD: 0 };
    for (const e of data || []) {
      const delta = e.direction === 'credit' ? e.amount_cents : -e.amount_cents;
      if (e.currency === 'USD') balances.USD += delta;
      else balances.CDF += delta;
    }
    return balances;
  }

  async getMyWallet(userId: string) {
    const wallet = await this.getWalletByUserId(userId);
    const balances = await this.getBalances(wallet.id);
    return { ...wallet, balances };
  }

  async getMyLedger(userId: string, filters?: { page?: number; limit?: number }) {
    const wallet = await this.getWalletByUserId(userId);
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;

    const { data, error, count } = await this.supabaseService.getClient()
      .from('ledger_entries')
      .select('*', { count: 'exact' })
      .eq('wallet_id', wallet.id)
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (error) {
      throw new Error(`Failed to fetch wallet ledger: ${error.message}`);
    }

    return { data, total: count || 0, page, limit };
  }

  async initiateTopup(
    userId: string,
    amountCents: number,
    currency: string,
    idempotencyKey: string,
    paymentMethod?: string,
    mobileMoneyOperator?: string,
    mobileMoneyPhone?: string,
  ) {
    if (!amountCents || amountCents < 100) {
      throw new BadRequestException('Minimum top-up amount is 100 cents');
    }
    // The Mobile Money withdrawal prompt (STK/USSD push) has to go to a real
    // phone number — never silently fall back to the account's registered
    // profile phone, which may not even be a Mobile Money line, let alone
    // the one the user wants to pull from for this specific top-up.
    if (paymentMethod === 'mobile_money' && !mobileMoneyPhone) {
      throw new BadRequestException('Numéro Mobile Money requis pour cette méthode de paiement');
    }

    const wallet = await this.getWalletByUserId(userId);

    if (wallet.status !== 'ACTIVE') {
      throw new BadRequestException(`Wallet is ${wallet.status}, cannot top up`);
    }

    const { data: existing } = await this.supabaseService.getClient()
      .from('wallet_topups')
      .select('*')
      .eq('idempotency_key', idempotencyKey)
      .single();

    if (existing) {
      const balances = await this.getBalances(wallet.id);
      return { topup: existing, balances, message: 'Top-up already exists (idempotent)' };
    }

    const { data: profile } = await this.supabaseService.getClient()
      .from('profiles')
      .select('full_name, email, phone')
      .eq('id', userId)
      .single();

    const adapter = this.pspFactory.get();
    const provider = adapter.provider;
    const reference = `TOPUP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${uuidv4().slice(0, 6).toUpperCase()}`;

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:5173');
    const backendUrl = `http://localhost:${this.configService.get<number>('PORT', 3000)}`;

    let pspResult;
    try {
      pspResult = await adapter.createPaymentIntent({
        amount_cents: amountCents,
        currency,
        reference,
        // The Mobile Money number entered for THIS top-up takes priority over
        // the account's registered profile phone — someone may be recharging
        // from a line that isn't the one they signed up with.
        customer: { email: profile?.email, phone: mobileMoneyPhone || profile?.phone, name: profile?.full_name },
        redirect_url: `${frontendUrl}/dashboard/wallet/topup/result?ref=${reference}`,
        webhook_url: `${backendUrl}/api/v1/payments/webhooks/${provider}`,
        metadata: {
          kind: 'wallet_topup',
          wallet_id: wallet.id,
          payment_method: paymentMethod,
          mobile_money_operator: mobileMoneyOperator,
          mobile_money_phone: mobileMoneyPhone,
        },
      });
    } catch (err: any) {
      this.logger.error(`CinetPay payment init failed: ${err.message}`, err.stack);
      if (err.message?.includes('not withlisted') || err.message?.includes('Authentication failed')) {
        throw new ServiceUnavailableException('Le service de paiement est temporairement indisponible. Veuillez réessayer plus tard.');
      }
      if (err.message?.includes('phone') || err.message?.includes('PhoneNumber') || err.message?.includes('international format')) {
        throw new BadRequestException('Numéro de téléphone invalide. Utilisez le format international (ex: +243XXXXXXXXX).');
      }
      throw new ServiceUnavailableException('Impossible d\'initialiser le paiement. Veuillez réessayer ou contacter le support.');
    }

    const { data: topup, error } = await this.supabaseService.getClient()
      .from('wallet_topups')
      .insert({
        wallet_id: wallet.id,
        amount_cents: amountCents,
        currency,
        status: 'PENDING',
        psp_provider: provider,
        psp_intent_id: pspResult.psp_intent_id,
        idempotency_key: idempotencyKey,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create wallet top-up: ${error.message}`);
    }

    // Mock PSP has no real checkout/webhook delivery — simulate the same
    // short "confirming on your phone" delay used for merchant payments,
    // then credit immediately (see payments.service.ts for the sibling flow).
    if (provider === 'mock') {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await this.completeTopup(topup.id, pspResult.psp_intent_id);
      const balances = await this.getBalances(wallet.id);
      return { topup: { ...topup, status: 'SUCCESS' }, balances };
    }

    return { topup, checkout_url: pspResult.checkout_url };
  }

  /**
   * Confirms a top-up and credits the wallet — called either directly (mock
   * provider) or from payments.service.ts's webhook dispatcher once a real
   * PSP confirms payment. Idempotent: a top-up already SUCCESS is a no-op.
   */
  async completeTopup(topupId: string, pspIntentId?: string): Promise<void> {
    const { data: topup } = await this.supabaseService.getClient()
      .from('wallet_topups')
      .select('*')
      .eq('id', topupId)
      .single();

    if (!topup) {
      throw new NotFoundException('Wallet top-up not found');
    }

    if (topup.status === 'SUCCESS') {
      return;
    }

    const { error: rpcError } = await this.supabaseService.getClient().rpc('credit_wallet', {
      p_wallet_id: topup.wallet_id,
      p_amount_cents: topup.amount_cents,
      p_entry_type: 'TOPUP',
      p_reference: `TOPUP-${topup.id}`,
      p_currency: topup.currency,
      p_metadata: { wallet_topup_id: topup.id, psp_intent_id: pspIntentId },
    });

    if (rpcError) {
      throw new Error(`Failed to credit wallet: ${rpcError.message}`);
    }

    await this.supabaseService.getClient()
      .from('wallet_topups')
      .update({ status: 'SUCCESS', updated_at: new Date().toISOString() })
      .eq('id', topupId);

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

    this.logger.log(`Wallet top-up ${topup.id} completed, wallet ${topup.wallet_id} credited ${topup.amount_cents} ${topup.currency} cents`);
  }

  /** Used by payments.service.ts's webhook dispatcher to find a wallet_topups row by psp_intent_id. */
  async findTopupByPspIntentId(pspIntentId: string) {
    const { data } = await this.supabaseService.getClient()
      .from('wallet_topups')
      .select('*')
      .eq('psp_intent_id', pspIntentId)
      .single();
    return data;
  }

  // ==========================================================================
  // PIN
  // ==========================================================================

  /**
   * Fee/limit preview — lets the frontend show "montant + frais = total"
   * before the user confirms anything (§54: never hide fees), without
   * executing or reserving anything.
   */
  async previewFee(opType: 'TRANSFER' | 'WITHDRAWAL' | 'WALLET_PAYMENT', amountCents: number, currency: string) {
    const rule = await this.walletLimitsService.getRule(opType, currency);
    return this.walletLimitsService.quoteFee(amountCents, rule);
  }

  async getPinStatus(userId: string) {
    return { has_pin: await this.walletPinService.hasPinSet(userId) };
  }

  async setPin(userId: string, newPin: string, currentPin?: string) {
    await this.walletPinService.setPin(userId, newPin, currentPin);
    await this.auditService.log({
      user_id: userId,
      action: 'wallet_pin_set',
      entity_type: 'profile',
      entity_id: userId,
    });
    return { success: true };
  }

  // ==========================================================================
  // Lookup — search a recipient/merchant by LinkPay number. Only the minimum
  // needed to confirm "who am I sending to" is returned (masked display
  // name) — never email/phone/full profile, and knowing a number never
  // allows modifying that account (read-only, no mutation endpoint takes a
  // bare wallet_number for anything but this lookup + being a transfer target).
  // ==========================================================================

  async lookupWallet(walletNumber: string) {
    const { data: wallet, error } = await this.supabaseService.getClient()
      .from('wallets')
      .select('id, user_id, wallet_number, status')
      .eq('wallet_number', walletNumber.trim().toUpperCase())
      .single();

    if (error || !wallet) {
      throw new NotFoundException('Numéro LinkPay introuvable');
    }
    if (wallet.status !== 'ACTIVE') {
      throw new BadRequestException('Ce compte LinkPay n\'est pas actif');
    }

    const isMerchant = wallet.wallet_number.startsWith('LP-MER-');

    if (isMerchant) {
      const { data: merchant } = await this.supabaseService.getClient()
        .from('merchants')
        .select('name, logo_url')
        .eq('owner_id', wallet.user_id)
        .maybeSingle();

      return {
        wallet_number: wallet.wallet_number,
        is_merchant: true,
        display_name: merchant?.name || 'Marchand LinkPay',
        logo_url: merchant?.logo_url || null,
      };
    }

    const { data: profile } = await this.supabaseService.getClient()
      .from('profiles')
      .select('full_name')
      .eq('id', wallet.user_id)
      .maybeSingle();

    return {
      wallet_number: wallet.wallet_number,
      is_merchant: false,
      display_name: maskName(profile?.full_name),
      logo_url: null,
    };
  }

  // ==========================================================================
  // Transfer — user-to-user, by LinkPay number. Atomic via the transfer_wallet
  // RPC (see 007_wallet_phase2.sql): both ledger entries are written in one
  // Postgres transaction, so a transfer is never half-applied.
  // ==========================================================================

  async transfer(
    userId: string,
    dto: { recipient_wallet_number: string; amount_cents: number; currency: string; description?: string; pin: string },
    idempotencyKey: string,
  ) {
    if (!dto.amount_cents || dto.amount_cents < 1) {
      throw new BadRequestException('Montant invalide');
    }

    const { data: existing } = await this.supabaseService.getClient()
      .from('transfers')
      .select('*')
      .eq('idempotency_key', idempotencyKey)
      .single();

    if (existing) {
      // A row stuck PENDING here would mean the process crashed between
      // creating it and calling transfer_wallet() below — this flow is
      // otherwise fully synchronous, so PENDING never means "still being
      // processed elsewhere". Extremely rare in practice; not auto-retried
      // here to avoid a duplicate-idempotency-key insert below, but it's
      // exactly the kind of row an admin/ops query should watch for.
      return { transfer: existing, message: 'Transfer already exists (idempotent)' };
    }

    const senderWallet = await this.getWalletByUserId(userId);
    if (senderWallet.status !== 'ACTIVE') {
      throw new BadRequestException(`Votre wallet est ${senderWallet.status}, transfert impossible`);
    }

    const recipient = await this.lookupWallet(dto.recipient_wallet_number);
    const { data: recipientWallet, error: recipientError } = await this.supabaseService.getClient()
      .from('wallets')
      .select('id, user_id')
      .eq('wallet_number', recipient.wallet_number)
      .single();

    if (recipientError || !recipientWallet) {
      throw new NotFoundException('Destinataire introuvable');
    }

    if (recipientWallet.id === senderWallet.id) {
      throw new BadRequestException('Vous ne pouvez pas vous transférer de l\'argent à vous-même');
    }

    // PIN verified only after the cheap checks above, but always before any
    // money moves — never trust the frontend's "user confirmed" state.
    await this.walletPinService.verifyPin(userId, dto.pin);

    const rule = await this.walletLimitsService.getRule('TRANSFER', dto.currency);
    const fee = this.walletLimitsService.quoteFee(dto.amount_cents, rule);
    await this.walletLimitsService.assertWithinLimits(senderWallet.id, 'TRANSFER', fee.total_cents, rule);

    const { data: transferRow, error: insertError } = await this.supabaseService.getClient()
      .from('transfers')
      .insert({
        sender_wallet_id: senderWallet.id,
        recipient_wallet_id: recipientWallet.id,
        amount_cents: dto.amount_cents,
        fee_cents: fee.fee_cents,
        currency: dto.currency,
        status: 'PENDING',
        description: dto.description,
        idempotency_key: idempotencyKey,
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Failed to create transfer: ${insertError.message}`);
    }

    const { data: result, error: rpcError } = await this.supabaseService.getClient()
      .rpc('transfer_wallet', { p_transfer_id: transferRow.id })
      .single();

    if (rpcError) {
      // A raised exception inside transfer_wallet() rolls back everything
      // that RPC call did in its own transaction — including any status
      // update it might have attempted — so this row is still PENDING at
      // this point. Mark it FAILED here, from the caller, or a retry with
      // the same Idempotency-Key would keep finding a stale PENDING row
      // forever instead of a clear terminal failure.
      await this.supabaseService.getClient()
        .from('transfers')
        .update({ status: 'FAILED', failure_reason: this.classifyTransferFailure(rpcError.message), updated_at: new Date().toISOString() })
        .eq('id', transferRow.id);
      throw new BadRequestException(this.explainTransferFailure(rpcError.message));
    }

    // The money has already moved at this point (transfer_wallet succeeded)
    // — everything below is best-effort bookkeeping. None of it should be
    // able to make this call report "failed, nothing was debited" when the
    // debit in fact already happened, so failures here are logged, not
    // thrown.
    const { data: finalTransfer } = await this.supabaseService.getClient()
      .from('transfers')
      .select('*')
      .eq('id', transferRow.id)
      .single();

    await this.auditService.log({
      user_id: userId,
      action: 'wallet_transfer',
      entity_type: 'transfer',
      entity_id: transferRow.id,
      changes: { amount_cents: dto.amount_cents, recipient_wallet_number: recipient.wallet_number },
    }).catch((err: any) => this.logger.warn(`Audit log failed for transfer ${transferRow.id}: ${err.message}`));

    await this.notificationsService.create({
      user_id: userId,
      type: 'transfer_sent',
      title: 'Transfert envoyé',
      body: `Votre transfert de ${(dto.amount_cents / 100).toLocaleString('fr-FR')} ${dto.currency} à ${recipient.display_name} a été effectué.`,
      data: { transfer_id: transferRow.id },
    }).catch(() => null);

    if (recipientWallet.user_id) {
      await this.notificationsService.create({
        user_id: recipientWallet.user_id,
        type: 'transfer_received',
        title: 'Transfert reçu',
        body: `Vous avez reçu ${(dto.amount_cents / 100).toLocaleString('fr-FR')} ${dto.currency}.`,
        data: { transfer_id: transferRow.id },
      }).catch(() => null);
    }

    return {
      transfer: finalTransfer || { ...transferRow, status: 'SUCCESS' },
      recipient: { wallet_number: recipient.wallet_number, display_name: recipient.display_name },
      sender_balance: (result as any)?.sender_balance,
    };
  }

  private classifyTransferFailure(message: string): string {
    if (message?.includes('INSUFFICIENT_BALANCE')) return 'INSUFFICIENT_BALANCE';
    if (message?.includes('SENDER_WALLET_')) return message.match(/SENDER_WALLET_\w+/)?.[0] || 'SENDER_WALLET_INACTIVE';
    if (message?.includes('RECIPIENT_WALLET_')) return message.match(/RECIPIENT_WALLET_\w+/)?.[0] || 'RECIPIENT_WALLET_INACTIVE';
    return 'UNKNOWN';
  }

  private explainTransferFailure(message: string): string {
    if (message?.includes('INSUFFICIENT_BALANCE')) return 'Solde LinkPay insuffisant pour ce transfert.';
    if (message?.includes('not PENDING')) return 'Ce transfert a déjà été traité.';
    if (message?.includes('WALLET_')) return 'Le compte du destinataire ou de l\'expéditeur n\'est pas actif.';
    return 'Le transfert a échoué. Aucun montant n\'a été débité.';
  }

  async getMyTransfers(userId: string, filters?: { page?: number; limit?: number }) {
    const wallet = await this.getWalletByUserId(userId);
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;

    const { data, error, count } = await this.supabaseService.getClient()
      .from('transfers')
      .select('*', { count: 'exact' })
      .or(`sender_wallet_id.eq.${wallet.id},recipient_wallet_id.eq.${wallet.id}`)
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (error) throw new Error(`Failed to fetch transfers: ${error.message}`);
    return { data: (data || []).map((t: any) => ({ ...t, direction: t.sender_wallet_id === wallet.id ? 'out' : 'in' })), total: count || 0, page, limit };
  }

  // ==========================================================================
  // Withdrawal — reserves funds immediately (debit_wallet), then settles.
  // No real Mobile Money/bank payout PSP is integrated yet — the mock
  // provider settles automatically after a short delay, same honesty
  // constraint as wallet top-ups (README already documents "mock: succès
  // automatique"). A real payout integration would replace only the
  // settlement step below; the reservation/restitution mechanics stay.
  // ==========================================================================

  async requestWithdrawal(
    userId: string,
    dto: { amount_cents: number; currency: string; channel: 'mobile_money' | 'bank'; destination: Record<string, any>; pin: string },
    idempotencyKey: string,
  ) {
    if (!dto.amount_cents || dto.amount_cents < 1) {
      throw new BadRequestException('Montant invalide');
    }
    if (!dto.destination || Object.keys(dto.destination).length === 0) {
      throw new BadRequestException('Compte de destination requis');
    }

    const { data: existing } = await this.supabaseService.getClient()
      .from('withdrawals')
      .select('*')
      .eq('idempotency_key', idempotencyKey)
      .single();

    if (existing) {
      return { withdrawal: existing, message: 'Withdrawal already exists (idempotent)' };
    }

    const wallet = await this.getWalletByUserId(userId);
    if (wallet.status !== 'ACTIVE') {
      throw new BadRequestException(`Votre wallet est ${wallet.status}, retrait impossible`);
    }

    await this.walletPinService.verifyPin(userId, dto.pin);

    const rule = await this.walletLimitsService.getRule('WITHDRAWAL', dto.currency);
    const fee = this.walletLimitsService.quoteFee(dto.amount_cents, rule);
    await this.walletLimitsService.assertWithinLimits(wallet.id, 'WITHDRAWAL', fee.total_cents, rule);

    const { data: withdrawal, error: insertError } = await this.supabaseService.getClient()
      .from('withdrawals')
      .insert({
        wallet_id: wallet.id,
        amount_cents: dto.amount_cents,
        fee_cents: fee.fee_cents,
        currency: dto.currency,
        channel: dto.channel,
        destination: dto.destination,
        status: 'PENDING',
        psp_provider: 'mock',
        idempotency_key: idempotencyKey,
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Failed to create withdrawal: ${insertError.message}`);
    }

    // Reserve the funds immediately — debit_wallet raises on insufficient
    // balance, which we surface as a clean error and mark the request FAILED
    // rather than leaving it dangling PENDING with no funds reserved.
    const { error: debitError } = await this.supabaseService.getClient().rpc('debit_wallet', {
      p_wallet_id: wallet.id,
      p_amount_cents: fee.total_cents,
      p_entry_type: 'WITHDRAWAL',
      p_reference: `WITHDRAWAL-${withdrawal.id}`,
      p_currency: dto.currency,
      p_metadata: { withdrawal_id: withdrawal.id, channel: dto.channel },
    });

    if (debitError) {
      await this.supabaseService.getClient()
        .from('withdrawals')
        .update({ status: 'FAILED', failure_reason: 'INSUFFICIENT_BALANCE', updated_at: new Date().toISOString() })
        .eq('id', withdrawal.id);
      throw new BadRequestException('Solde LinkPay insuffisant pour ce retrait.');
    }

    await this.auditService.log({
      user_id: userId,
      action: 'wallet_withdrawal_requested',
      entity_type: 'withdrawal',
      entity_id: withdrawal.id,
      changes: { amount_cents: dto.amount_cents, channel: dto.channel },
    });

    await this.notificationsService.create({
      user_id: userId,
      type: 'withdrawal_processing',
      title: 'Retrait en cours',
      body: `Votre retrait de ${(dto.amount_cents / 100).toLocaleString('fr-FR')} ${dto.currency} est en cours.`,
      data: { withdrawal_id: withdrawal.id },
    }).catch(() => null);

    // Mock settlement only — see module comment above. Real payout would
    // move this into a webhook-driven confirmation exactly like top-ups.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const { data: settled } = await this.supabaseService.getClient()
      .from('withdrawals')
      .update({ status: 'SUCCESS', psp_reference: `mock_wd_${uuidv4().slice(0, 12)}`, updated_at: new Date().toISOString() })
      .eq('id', withdrawal.id)
      .select()
      .single();

    await this.notificationsService.create({
      user_id: userId,
      type: 'withdrawal_success',
      title: 'Retrait effectué',
      body: `Votre retrait de ${(dto.amount_cents / 100).toLocaleString('fr-FR')} ${dto.currency} a été effectué.`,
      data: { withdrawal_id: withdrawal.id },
    }).catch(() => null);

    return { withdrawal: settled };
  }

  /** Restitution: credits back a reserved withdrawal that ultimately failed after reservation (e.g. a real payout PSP rejecting it later via webhook). Not currently wired to any caller — the mock provider never fails post-reservation — but kept ready for when a real payout integration replaces the settlement step. */
  async reverseFailedWithdrawal(withdrawalId: string, reason: string) {
    const { data: withdrawal } = await this.supabaseService.getClient()
      .from('withdrawals')
      .select('*')
      .eq('id', withdrawalId)
      .single();

    if (!withdrawal || withdrawal.status === 'REVERSED' || withdrawal.status === 'SUCCESS') return;

    await this.supabaseService.getClient().rpc('credit_wallet', {
      p_wallet_id: withdrawal.wallet_id,
      p_amount_cents: withdrawal.amount_cents + withdrawal.fee_cents,
      p_entry_type: 'ADJUSTMENT',
      p_reference: `WITHDRAWAL-REVERSAL-${withdrawal.id}`,
      p_currency: withdrawal.currency,
      p_metadata: { withdrawal_id: withdrawal.id, reason },
    });

    await this.supabaseService.getClient()
      .from('withdrawals')
      .update({ status: 'REVERSED', failure_reason: reason, updated_at: new Date().toISOString() })
      .eq('id', withdrawalId);
  }

  async getMyWithdrawals(userId: string, filters?: { page?: number; limit?: number }) {
    const wallet = await this.getWalletByUserId(userId);
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;

    const { data, error, count } = await this.supabaseService.getClient()
      .from('withdrawals')
      .select('*', { count: 'exact' })
      .eq('wallet_id', wallet.id)
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (error) throw new Error(`Failed to fetch withdrawals: ${error.message}`);
    return { data, total: count || 0, page, limit };
  }
}

/** "Jean Kambale" -> "Jean K." — never expose a recipient's full name from a bare number lookup. */
function maskName(fullName?: string | null): string {
  if (!fullName) return 'Utilisateur LinkPay';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}
