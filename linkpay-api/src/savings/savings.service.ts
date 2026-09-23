import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { WalletPinService } from '../wallets/wallet-pin.service';

/**
 * Round-up savings ("épargne par arrondi") — opt-in, per user, for both
 * client and merchant wallets alike (no role restriction anywhere here).
 * Deliberately not a second `wallets` row (would break every `.single()`
 * wallet lookup elsewhere) — a small standalone ledger-style system instead,
 * moving real money against the main wallet only through the existing
 * credit_wallet/debit_wallet Postgres primitives (via the
 * round_up_to_savings/withdraw_from_savings_pot RPCs — see migration
 * 022_savings_pots.sql), never a raw balance update.
 */
@Injectable()
export class SavingsService {
  private readonly logger = new Logger(SavingsService.name);

  constructor(
    private supabaseService: SupabaseService,
    private walletPinService: WalletPinService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  private async getOrCreatePot(userId: string) {
    const { data: existing } = await this.db.from('savings_pots').select('*').eq('user_id', userId).maybeSingle();
    if (existing) return existing;

    const { data: created, error } = await this.db
      .from('savings_pots')
      .insert({ user_id: userId })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create savings pot: ${error.message}`);
    }
    return created;
  }

  private async getBalance(potId: string): Promise<number> {
    const { data: entries } = await this.db.from('savings_pot_entries').select('type, amount_cents').eq('pot_id', potId);
    return (entries || []).reduce((sum, e: any) => sum + (e.type === 'round_up' ? e.amount_cents : -e.amount_cents), 0);
  }

  async getMyPot(userId: string) {
    const pot = await this.getOrCreatePot(userId);
    const balance_cents = await this.getBalance(pot.id);

    const { data: entries } = await this.db
      .from('savings_pot_entries')
      .select('*')
      .eq('pot_id', pot.id)
      .order('created_at', { ascending: false })
      .limit(20);

    return { pot, balance_cents, entries: entries || [] };
  }

  async updateSettings(
    userId: string,
    dto: { round_up_enabled?: boolean; round_up_increment_cents?: number; goal_name?: string; goal_amount_cents?: number },
  ) {
    const pot = await this.getOrCreatePot(userId);

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (dto.round_up_enabled !== undefined) updates.round_up_enabled = dto.round_up_enabled;
    if (dto.round_up_increment_cents !== undefined) updates.round_up_increment_cents = dto.round_up_increment_cents;
    if (dto.goal_name !== undefined) updates.goal_name = dto.goal_name;
    if (dto.goal_amount_cents !== undefined) updates.goal_amount_cents = dto.goal_amount_cents;

    const { data: updated, error } = await this.db
      .from('savings_pots')
      .update(updates)
      .eq('id', pot.id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update savings settings: ${error.message}`);
    }
    return { pot: updated };
  }

  /** The free-anytime withdrawal, back to the caller's own main wallet — a
   * real money movement, so it requires the PIN like transfer/payWithWallet. */
  async withdraw(userId: string, amountCents: number, pin: string) {
    if (!amountCents || amountCents < 1) {
      throw new BadRequestException('Montant invalide');
    }

    await this.walletPinService.verifyPin(userId, pin);

    const { data: wallet } = await this.db.from('wallets').select('id').eq('user_id', userId).single();
    if (!wallet) {
      throw new NotFoundException('Wallet introuvable');
    }

    const { data: newBalance, error } = await this.db.rpc('withdraw_from_savings_pot', {
      p_wallet_id: wallet.id,
      p_user_id: userId,
      p_amount_cents: amountCents,
    });

    if (error) {
      throw new BadRequestException(error.message.includes('Insufficient') ? 'Solde de la tirelire insuffisant' : 'Échec du retrait');
    }

    return { pot_balance_cents: newBalance };
  }

  /** Best-effort — called by WalletsService.transfer() and
   * PaymentsService.payWithWallet() strictly AFTER their own money movement
   * has already succeeded. Never throws: any failure (pot not enabled,
   * insufficient balance for the small extra amount, etc.) just means no
   * round-up happens this time — the triggering payment/transfer is
   * completely unaffected either way. CDF only — USD amounts are never
   * rounded (see migration/plan notes). */
  async maybeRoundUp(userId: string, walletId: string, amountCents: number, currency: string, reference: string) {
    if (currency !== 'CDF') return null;

    const { data: pot } = await this.db
      .from('savings_pots')
      .select('id, round_up_enabled, round_up_increment_cents')
      .eq('user_id', userId)
      .maybeSingle();

    if (!pot?.round_up_enabled || !pot.round_up_increment_cents) return null;

    const remainder = amountCents % pot.round_up_increment_cents;
    const delta = remainder === 0 ? 0 : pot.round_up_increment_cents - remainder;
    if (delta <= 0) return null;

    try {
      const { data: newBalance, error } = await this.db.rpc('round_up_to_savings', {
        p_wallet_id: walletId,
        p_user_id: userId,
        p_amount_cents: delta,
        p_reference: reference,
      });
      if (error) throw new Error(error.message);

      return { amount_cents: delta, pot_balance_cents: newBalance };
    } catch (err: any) {
      this.logger.warn(`Round-up skipped for user ${userId} (${reference}): ${err.message}`);
      return null;
    }
  }
}
