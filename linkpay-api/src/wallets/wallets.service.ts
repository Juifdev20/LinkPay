import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { SupabaseService } from '../supabase/supabase.service';
import { PspFactory } from '../payments/psp/psp.factory';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(
    private supabaseService: SupabaseService,
    private pspFactory: PspFactory,
    private notificationsService: NotificationsService,
    private configService: ConfigService,
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

  async getBalance(walletId: string): Promise<number> {
    const { data, error } = await this.supabaseService.getClient()
      .from('ledger_entries')
      .select('amount_cents, direction')
      .eq('wallet_id', walletId);

    if (error) {
      throw new Error(`Failed to compute wallet balance: ${error.message}`);
    }

    return (data || []).reduce(
      (sum: number, e: any) => sum + (e.direction === 'credit' ? e.amount_cents : -e.amount_cents),
      0,
    );
  }

  async getMyWallet(userId: string) {
    const wallet = await this.getWalletByUserId(userId);
    const balanceCents = await this.getBalance(wallet.id);
    return { ...wallet, balance_cents: balanceCents };
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

  async initiateTopup(userId: string, amountCents: number, idempotencyKey: string) {
    if (!amountCents || amountCents < 100) {
      throw new BadRequestException('Minimum top-up amount is 100 cents');
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
      const balance = await this.getBalance(wallet.id);
      return { topup: existing, balance_cents: balance, message: 'Top-up already exists (idempotent)' };
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

    const pspResult = await adapter.createPaymentIntent({
      amount_cents: amountCents,
      currency: wallet.currency,
      reference,
      customer: { email: profile?.email, phone: profile?.phone, name: profile?.full_name },
      redirect_url: `${frontendUrl}/dashboard/wallet/topup/result?ref=${reference}`,
      webhook_url: `${backendUrl}/api/v1/payments/webhooks/${provider}`,
      metadata: { kind: 'wallet_topup', wallet_id: wallet.id },
    });

    const { data: topup, error } = await this.supabaseService.getClient()
      .from('wallet_topups')
      .insert({
        wallet_id: wallet.id,
        amount_cents: amountCents,
        currency: wallet.currency,
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
      const newBalance = await this.completeTopup(topup.id, pspResult.psp_intent_id);
      return { topup: { ...topup, status: 'SUCCESS' }, balance_cents: newBalance };
    }

    return { topup, checkout_url: pspResult.checkout_url };
  }

  /**
   * Confirms a top-up and credits the wallet — called either directly (mock
   * provider) or from payments.service.ts's webhook dispatcher once a real
   * PSP confirms payment. Idempotent: a top-up already SUCCESS is a no-op.
   */
  async completeTopup(topupId: string, pspIntentId?: string): Promise<number> {
    const { data: topup } = await this.supabaseService.getClient()
      .from('wallet_topups')
      .select('*')
      .eq('id', topupId)
      .single();

    if (!topup) {
      throw new NotFoundException('Wallet top-up not found');
    }

    if (topup.status === 'SUCCESS') {
      return this.getBalance(topup.wallet_id);
    }

    const { data: newBalance, error: rpcError } = await this.supabaseService.getClient().rpc('credit_wallet', {
      p_wallet_id: topup.wallet_id,
      p_amount_cents: topup.amount_cents,
      p_entry_type: 'TOPUP',
      p_reference: `TOPUP-${topup.id}`,
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
      .select('user_id, currency')
      .eq('id', topup.wallet_id)
      .single();

    if (wallet?.user_id) {
      await this.notificationsService.create({
        user_id: wallet.user_id,
        type: 'wallet_topup_success',
        title: 'Portefeuille rechargé',
        body: `Votre compte LinkPay a été crédité de ${(topup.amount_cents / 100).toLocaleString('fr-FR')} ${wallet.currency}.`,
        data: { wallet_topup_id: topup.id },
      }).catch(() => null);
    }

    this.logger.log(`Wallet top-up ${topup.id} completed, wallet ${topup.wallet_id} credited ${topup.amount_cents} cents`);
    return newBalance as number;
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
}
