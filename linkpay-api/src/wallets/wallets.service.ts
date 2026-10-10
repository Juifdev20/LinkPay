import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { SupabaseService } from '../supabase/supabase.service';
import { PspFactory } from '../payments/psp/psp.factory';
import { NotificationsService } from '../notifications/notifications.service';
import { WalletPinService } from './wallet-pin.service';
import { WalletLimitsService } from './wallet-limits.service';
import { AuditService } from '../audit/audit.service';
import { RiskService } from '../risk/risk.service';
import { SavingsService } from '../savings/savings.service';
import { WithdrawalPayoutService } from './withdrawal-payout.service';
import { completeTopupOnce } from './topup-completion';
import { confirmedAmountMatches } from '../payments/psp/amount-check';
import { assertNumberMatchesOperator } from '../payments/mobile-money';

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
    private savingsService: SavingsService,
    private withdrawalPayouts: WithdrawalPayoutService,
    private riskService: RiskService,
  ) {}

  async getWalletByUserId(userId: string) {
    const { data, error } = await this.supabaseService.getClient()
      .from('wallets')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (data) return data;
    if (error && error.code !== 'PGRST116') throw new NotFoundException('Wallet not found');

    // Employees created by their patron before wallets were given to them have none yet:
    // open it on first use, so they can receive and withdraw their salary.
    // (Administrators deliberately have no wallet.)
    const { data: roles } = await this.supabaseService.getClient()
      .from('user_roles')
      .select('role:roles(slug)')
      .eq('user_id', userId);
    const slugs = (roles || []).map((r: any) => r.role?.slug);
    if (slugs.length === 0 || slugs.some((s: string) => s === 'admin' || s === 'super_admin')) {
      throw new NotFoundException('Wallet not found');
    }
    await this.supabaseService.getClient().from('wallets').upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });
    const { data: created } = await this.supabaseService.getClient().from('wallets').select('*').eq('user_id', userId).single();
    if (!created) throw new NotFoundException('Wallet not found');
    return created;
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

  /**
   * Which ways of paying the app offers for a top-up. The bank card goes through the provider's own payment page
   * (FlexPaie, type 2): it is offered only when the provider supports it AND it was switched on (CARD_PAYMENTS_ENABLED=true
   * on Render, after a real test), so a half-tested channel is never open to everybody. The mock provider (demo) allows it.
   */
  paymentMethods(): { mobile_money: boolean; card: boolean } {
    const provider = this.pspFactory.get().provider;
    const switchedOn = String(this.configService.get<string>('CARD_PAYMENTS_ENABLED', '') ?? '').trim().toLowerCase() === 'true';
    return { mobile_money: true, card: provider === 'mock' || (provider === 'flexpaie' && switchedOn) };
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
    // The number has to be the chosen network's own (the push goes to the line, not to the operator named on screen).
    if (paymentMethod === 'mobile_money') assertNumberMatchesOperator(mobileMoneyOperator, mobileMoneyPhone);
    if (paymentMethod === 'card' && !this.paymentMethods().card) {
      throw new BadRequestException("Le paiement par carte bancaire n'est pas encore disponible.");
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
    const backendUrl = this.configService.get<string>('BACKEND_URL')
      || this.configService.get<string>('RENDER_EXTERNAL_URL')
      || `http://localhost:${this.configService.get<number>('PORT', 3000)}`;

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
        // Mobile Money: our own result page (opened inside the app). Card: the customer comes back from the provider's
        // page, possibly in the phone's browser where nobody is signed in — a neutral return page handles both.
        redirect_url: paymentMethod === 'card'
          ? `${frontendUrl}/payment/return?to=topup&ref=${reference}`
          : `${frontendUrl}/dashboard/wallet/topup/result?ref=${reference}`,
        webhook_url: `${backendUrl}/api/v1/webhooks/${provider}`,
        metadata: {
          kind: 'wallet_topup',
          wallet_id: wallet.id,
          payment_method: paymentMethod,
          mobile_money_operator: mobileMoneyOperator,
          mobile_money_phone: mobileMoneyPhone,
        },
      });
    } catch (err: any) {
      // A clear refusal of ours (an amount with cents, a missing number) is told as it is, not hidden behind "unavailable".
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`Payment provider init failed: ${err.message}`, err.stack);
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
    let outcome;
    try {
      outcome = await completeTopupOnce(this.supabaseService.getClient(), topupId, pspIntentId, this.logger);
    } catch (err: any) {
      if (/not found/i.test(err?.message)) throw new NotFoundException('Wallet top-up not found');
      throw err;
    }
    // Already completed by someone else (the webhook, a poll, a replay): nothing more to do.
    if (!outcome.credited || !outcome.userId) return;

    await this.notificationsService.create({
      user_id: outcome.userId,
      type: 'wallet_topup_success',
      title: 'Portefeuille rechargé',
      body: `Votre compte ScanLinkPay a été crédité de ${((outcome.amountCents ?? 0) / 100).toLocaleString('fr-FR')} ${outcome.currency}.`,
      data: { wallet_topup_id: topupId },
    }).catch(() => null);
  }

  /**
   * Marks a top-up as FAILED — the failure-side counterpart to completeTopup(),
   * used by the status-check endpoint when the PSP reports the transaction
   * did not succeed. Idempotent via the same atomic PENDING -> FAILED claim.
   */
  async failTopup(topupId: string): Promise<void> {
    await this.supabaseService.getClient()
      .from('wallet_topups')
      .update({ status: 'FAILED', updated_at: new Date().toISOString() })
      .eq('id', topupId)
      .eq('status', 'PENDING');
  }

  /**
   * Checks a top-up's status by reference — authenticated, ownership-checked
   * (never lets one user poll another's top-up by guessing its reference).
   * Used as the fallback source of truth when a webhook hasn't arrived yet:
   * if still PENDING, re-verifies with the PSP directly and applies the same
   * completeTopup/failTopup transition the webhook dispatcher uses.
   */
  async getTopupStatus(userId: string, reference: string) {
    const wallet = await this.getWalletByUserId(userId);

    const { data: topup } = await this.supabaseService.getClient()
      .from('wallet_topups')
      .select('*')
      .eq('psp_intent_id', reference)
      .eq('wallet_id', wallet.id)
      .maybeSingle();

    if (!topup) {
      throw new NotFoundException('Recharge introuvable');
    }

    if (topup.status === 'PENDING') {
      const adapter = this.pspFactory.get(topup.psp_provider);
      const live = await adapter.getTransactionStatus(topup.psp_intent_id);
      if (live.status === 'SUCCESS') {
        // The provider's confirmed amount must equal the one we recorded (rounding, partial or tampered payments).
        if (!confirmedAmountMatches(topup.amount_cents, live.amount_cents)) {
          this.logger.error(`Top-up ${topup.id}: the provider confirmed ${live.amount_cents} but ${topup.amount_cents} was expected — not credited`);
        } else {
          await this.completeTopup(topup.id, topup.psp_intent_id);
        }
      } else if (live.status === 'FAILED') {
        await this.failTopup(topup.id);
      }
    }

    const { data: refreshed } = await this.supabaseService.getClient()
      .from('wallet_topups')
      .select('*')
      .eq('id', topup.id)
      .single();

    const balances = await this.getBalances(wallet.id);
    return { topup: refreshed, balances };
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
  // Lookup — search a recipient/merchant by ScanLinkPay number. Only the minimum
  // needed to confirm "who am I sending to" is returned (masked display
  // name) — never email/phone/full profile, and knowing a number never
  // allows modifying that account (read-only, no mutation endpoint takes a
  // bare wallet_number for anything but this lookup + being a transfer target).
  // ==========================================================================

  /** The store or enterprise this user owns, if any (null for a plain client). */
  private async getBusinessOwnership(userId: string): Promise<{ name: string | null; logo_url: string | null } | null> {
    const db = this.supabaseService.getClient();
    const [{ data: merchant }, { data: org }] = await Promise.all([
      db.from('merchants').select('name, logo_url').eq('owner_id', userId).limit(1).maybeSingle(),
      db.from('organizations').select('name').eq('owner_id', userId).limit(1).maybeSingle(),
    ]);
    if (merchant) return { name: merchant.name ?? null, logo_url: merchant.logo_url ?? null };
    if (org) return { name: org.name ?? null, logo_url: null };
    return null;
  }

  async lookupWallet(walletNumber: string) {
    const { data: wallet, error } = await this.supabaseService.getClient()
      .from('wallets')
      .select('id, user_id, wallet_number, status')
      .eq('wallet_number', walletNumber.trim().toUpperCase())
      .single();

    if (error || !wallet) {
      throw new NotFoundException('Numéro ScanLinkPay introuvable');
    }
    if (wallet.status !== 'ACTIVE') {
      throw new BadRequestException('Ce compte ScanLinkPay n\'est pas actif');
    }

    // Business-ness comes from who OWNS the wallet, not from its number: the
    // "-MER-" prefix is fixed when the wallet is created, so someone who
    // becomes a merchant later keeps a plain "SLP-" number.
    const business = await this.getBusinessOwnership(wallet.user_id);

    if (business) {
      return {
        wallet_number: wallet.wallet_number,
        is_merchant: true,
        // Sales must go through a payment request (invoice / "Encaisser"):
        // that is what records the sale, issues a receipt and charges the
        // platform commission. A plain transfer does none of that.
        accepts_transfers: false,
        display_name: business.name || 'Marchand ScanLinkPay',
        logo_url: business.logo_url || null,
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
      accepts_transfers: true,
      display_name: maskName(profile?.full_name),
      logo_url: null,
    };
  }

  // ==========================================================================
  // Transfer — user-to-user, by ScanLinkPay number. Atomic via the transfer_wallet
  // RPC (see 007_wallet_phase2.sql): both ledger entries are written in one
  // Postgres transaction, so a transfer is never half-applied.
  // ==========================================================================

  async transfer(
    userId: string,
    dto: { recipient_wallet_number: string; amount_cents: number; currency: string; description?: string; pin: string },
    idempotencyKey: string,
    // Internal-only — never settable from a public DTO/controller. Exists
    // solely for TontinesService's auto-payment cron path, where the member
    // already gave standing consent (auto_payment_opt_in) instead of
    // entering their PIN for this specific transfer.
    internalOptions?: { skipPinVerification?: boolean; allowBusinessRecipient?: boolean },
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
      // A key is only a replay if it is the SAME operation by the SAME person. Anything else is a reused or guessed key:
      // answering it with someone else's (or a different) transfer would let a caller — the tontine flow in particular —
      // treat a transfer that never happened as theirs.
      const mine = await this.getWalletByUserId(userId);
      const { data: sameRecipient } = await this.supabaseService.getClient()
        .from('wallets').select('id').eq('wallet_number', dto.recipient_wallet_number).maybeSingle();
      if (
        existing.sender_wallet_id !== mine.id ||
        Number(existing.amount_cents) !== dto.amount_cents ||
        existing.currency !== dto.currency ||
        (sameRecipient && existing.recipient_wallet_id !== sameRecipient.id)
      ) {
        throw new ConflictException("Cette clé d'idempotence a déjà été utilisée pour une autre opération.");
      }
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

    // A transfer into a store's or enterprise's wallet is a sale made outside
    // the invoice flow: no receipt, no entry in the merchant's sales, and no
    // platform commission (transfers carry no fee by default). Customers must
    // pay through a payment request. Internal flows that legitimately move
    // money between members (tontines) opt out.
    if (!internalOptions?.allowBusinessRecipient && (await this.getBusinessOwnership(recipientWallet.user_id))) {
      throw new BadRequestException(
        "Ce compte est un compte marchand : il ne reçoit pas de transferts. Pour le payer, demandez-lui une facture (scannez son QR de paiement ou saisissez sa référence).",
      );
    }

    // PIN verified only after the cheap checks above, but always before any
    // money moves — never trust the frontend's "user confirmed" state.
    // Skipped only for the pre-authorized tontine auto-payment path (see
    // internalOptions above) — every other caller still requires it.
    if (!internalOptions?.skipPinVerification) {
      await this.walletPinService.verifyPin(userId, dto.pin);
    }

    const rule = await this.walletLimitsService.getRule('TRANSFER', dto.currency);
    const fee = this.walletLimitsService.quoteFee(dto.amount_cents, rule);
    await this.walletLimitsService.assertWithinLimits(senderWallet.id, 'TRANSFER', fee.total_cents, rule);

    // Standing-consent flows (tontine auto-payments) have their own rules;
    // a person sending money gets the velocity checks.
    if (!internalOptions) {
      await this.riskService.assessOutflow({
        kind: 'TRANSFER', userId, walletId: senderWallet.id, amountCents: dto.amount_cents,
        currency: dto.currency, recipientWalletId: recipientWallet.id,
      });
    }

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
        .eq('id', transferRow.id)
        // Never flip a transfer that may in fact have completed (an ambiguous timeout after the commit) to FAILED.
        .eq('status', 'PENDING');
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
        data: { transfer_id: transferRow.id, amount_cents: dto.amount_cents, currency: dto.currency },
      }).catch(() => null);
    }

    const roundup = await this.savingsService
      .maybeRoundUp(userId, senderWallet.id, dto.amount_cents, dto.currency, `transfer:${transferRow.id}`)
      .catch(() => null);

    return {
      transfer: finalTransfer || { ...transferRow, status: 'SUCCESS' },
      recipient: { wallet_number: recipient.wallet_number, display_name: recipient.display_name },
      sender_balance: (result as any)?.sender_balance,
      roundup,
    };
  }

  private classifyTransferFailure(message: string): string {
    if (message?.includes('INSUFFICIENT_BALANCE')) return 'INSUFFICIENT_BALANCE';
    if (message?.includes('SENDER_WALLET_')) return message.match(/SENDER_WALLET_\w+/)?.[0] || 'SENDER_WALLET_INACTIVE';
    if (message?.includes('RECIPIENT_WALLET_')) return message.match(/RECIPIENT_WALLET_\w+/)?.[0] || 'RECIPIENT_WALLET_INACTIVE';
    return 'UNKNOWN';
  }

  private explainTransferFailure(message: string): string {
    if (message?.includes('INSUFFICIENT_BALANCE')) return 'Solde ScanLinkPay insuffisant pour ce transfert.';
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
    if (dto.channel === 'mobile_money') assertNumberMatchesOperator(dto.destination.operator, dto.destination.phone);

    const wallet = await this.getWalletByUserId(userId);

    const { data: existing } = await this.supabaseService.getClient()
      .from('withdrawals')
      .select('*')
      .eq('idempotency_key', idempotencyKey)
      .single();

    if (existing) {
      return this.replayOf(existing, wallet.id, dto);
    }

    if (wallet.status !== 'ACTIVE') {
      throw new BadRequestException(`Votre wallet est ${wallet.status}, retrait impossible`);
    }

    await this.walletPinService.verifyPin(userId, dto.pin);

    const rule = await this.walletLimitsService.getRule('WITHDRAWAL', dto.currency);
    const fee = this.walletLimitsService.quoteFee(dto.amount_cents, rule);
    await this.walletLimitsService.assertWithinLimits(wallet.id, 'WITHDRAWAL', fee.total_cents, rule);

    await this.riskService.assessOutflow({
      kind: 'WITHDRAWAL', userId, walletId: wallet.id, amountCents: dto.amount_cents, currency: dto.currency,
    });

    const withdrawal = await this.createWithdrawalAtomically(wallet.id, fee, dto, idempotencyKey);
    if ('replay' in withdrawal) return withdrawal.replay;

    await this.auditService.log({
      user_id: userId,
      action: 'wallet_withdrawal_requested',
      entity_type: 'withdrawal',
      entity_id: withdrawal.id,
      changes: { amount_cents: dto.amount_cents, channel: dto.channel },
    });

    const manualPayout = this.pspFactory.get(withdrawal.psp_provider || undefined).supportsPayout === false;
    await this.notificationsService.create({
      user_id: userId,
      type: 'withdrawal_processing',
      title: manualPayout ? 'Demande de retrait enregistrée' : 'Retrait en cours',
      body: manualPayout
        ? `Votre demande de retrait de ${(dto.amount_cents / 100).toLocaleString('fr-FR')} ${dto.currency} est enregistrée. Elle sera traitée par notre équipe : vous serez averti dès que l'argent est envoyé.`
        : `Votre retrait de ${(dto.amount_cents / 100).toLocaleString('fr-FR')} ${dto.currency} est en cours.`,
      data: { withdrawal_id: withdrawal.id },
    }).catch(() => null);

    // The payout goes out through the payment provider. The withdrawal is
    // only reported as done once the provider confirms it; until then it
    // stays "PROCESSING" and WithdrawalPayoutService settles it (including
    // refunding the wallet if the provider confirms a failure).
    const backendUrl = this.configService.get<string>('BACKEND_URL')
      || this.configService.get<string>('RENDER_EXTERNAL_URL')
      || `http://localhost:${this.configService.get<number>('PORT', 3000)}`;
    const { withdrawal: settled, rejectedReason, manual } = await this.withdrawalPayouts.dispatch(
      withdrawal,
      `${backendUrl}/api/v1/webhooks/${withdrawal.psp_provider}`,
    );

    if (rejectedReason) {
      throw new BadRequestException(`Le retrait n'a pas pu être effectué : ${rejectedReason} Votre argent est resté dans votre portefeuille.`);
    }

    return { withdrawal: settled, ...(manual ? { manual: true } : {}) };
  }

  /** A key replays only the SAME withdrawal by the SAME wallet; anything else is a reused or guessed key. */
  private replayOf(existing: any, walletId: string, dto: { amount_cents: number; currency: string }) {
    if (existing.wallet_id !== walletId || Number(existing.amount_cents) !== dto.amount_cents || existing.currency !== dto.currency) {
      throw new ConflictException("Cette clé d'idempotence a déjà été utilisée pour une autre opération.");
    }
    return { withdrawal: existing, message: 'Withdrawal already exists (idempotent)' };
  }

  /**
   * Creates the withdrawal AND takes the money in one database transaction (request_withdrawal, migration 057):
   * a crash in between can no longer leave a withdrawal that was never debited (which the reconciliation would later
   * "refund" — money from nothing), and an ambiguous timeout can no longer be mistaken for "insufficient balance".
   */
  private async createWithdrawalAtomically(
    walletId: string,
    fee: { fee_cents: number; total_cents: number },
    dto: { amount_cents: number; currency: string; channel: string; destination: Record<string, any> },
    idempotencyKey: string,
  ): Promise<any> {
    const client = this.supabaseService.getClient();
    const { data, error } = await client.rpc('request_withdrawal', {
      p_wallet: walletId,
      p_amount: dto.amount_cents,
      p_fee: fee.fee_cents,
      p_currency: dto.currency,
      p_channel: dto.channel,
      p_destination: dto.destination,
      p_psp_provider: this.pspFactory.get().provider,
      p_idempotency_key: idempotencyKey,
    });
    if (!error && data) return Array.isArray(data) ? data[0] : data;

    if (error) {
      if (/Insufficient balance/i.test(error.message)) {
        throw new BadRequestException('Solde ScanLinkPay insuffisant pour ce retrait.');
      }
      if (/duplicate key|idempotency_key/i.test(error.message)) {
        // The same request arrived twice at once: the other one won. Answer with ITS withdrawal.
        const { data: winner } = await client.from('withdrawals').select('*').eq('idempotency_key', idempotencyKey).single();
        if (winner) return { replay: this.replayOf(winner, walletId, dto) };
      }
      if (!/could not find the function|does not exist|schema cache/i.test(error.message)) {
        throw new Error(`Failed to create withdrawal: ${error.message}`);
      }
      this.logger.warn('request_withdrawal() is not available (apply migration 057) — using the two-step fallback');
    }

    // Fallback (migration 057 not applied yet): the previous two-step flow.
    const { data: withdrawal, error: insertError } = await client
      .from('withdrawals')
      .insert({
        wallet_id: walletId,
        amount_cents: dto.amount_cents,
        fee_cents: fee.fee_cents,
        currency: dto.currency,
        channel: dto.channel,
        destination: dto.destination,
        status: 'PENDING',
        psp_provider: this.pspFactory.get().provider,
        idempotency_key: idempotencyKey,
      })
      .select()
      .single();
    if (insertError) throw new Error(`Failed to create withdrawal: ${insertError.message}`);

    const { error: debitError } = await client.rpc('debit_wallet', {
      p_wallet_id: walletId,
      p_amount_cents: fee.total_cents,
      p_entry_type: 'WITHDRAWAL',
      p_reference: `WITHDRAWAL-${withdrawal.id}`,
      p_currency: dto.currency,
      p_metadata: { withdrawal_id: withdrawal.id, channel: dto.channel },
    });
    if (debitError) {
      await client
        .from('withdrawals')
        .update({ status: 'FAILED', failure_reason: 'INSUFFICIENT_BALANCE', updated_at: new Date().toISOString() })
        .eq('id', withdrawal.id);
      throw new BadRequestException('Solde ScanLinkPay insuffisant pour ce retrait.');
    }
    return withdrawal;
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
  if (!fullName) return 'Utilisateur ScanLinkPay';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}
