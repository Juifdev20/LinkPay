import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { WalletPinService } from '../wallets/wallet-pin.service';

const CURRENCIES = ['CDF', 'USD'] as const;
type Currency = (typeof CURRENCIES)[number];

/**
 * Round-up savings ("épargne par arrondi") — opt-in, per user AND per
 * currency, for both client and merchant wallets alike (no role restriction
 * anywhere here). CDF and USD are fully independent — own toggle, own
 * increment, own goal, own balance — same principle already used everywhere
 * else in this app (see 008_multi_currency.sql), never auto-converted.
 * Deliberately not a second `wallets` row (would break every `.single()`
 * wallet lookup elsewhere) — a small standalone ledger-style system instead,
 * moving real money against the main wallet only through the existing
 * credit_wallet/debit_wallet Postgres primitives (via the
 * round_up_to_savings/withdraw_from_savings_pot RPCs — see migrations
 * 022_savings_pots.sql and 023_savings_multi_currency.sql), never a raw
 * balance update.
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

  private assertCurrency(currency: string): asserts currency is Currency {
    if (!CURRENCIES.includes(currency as Currency)) {
      throw new BadRequestException(`Devise invalide: ${currency}`);
    }
  }

  private async getPot(userId: string, currency: string) {
    const { data } = await this.db.from('savings_pots').select('*').eq('user_id', userId).eq('currency', currency).maybeSingle();
    return data;
  }

  private async getOrCreatePot(userId: string, currency: string) {
    const existing = await this.getPot(userId, currency);
    if (existing) return existing;

    const { data: created, error } = await this.db
      .from('savings_pots')
      .insert({ user_id: userId, currency })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create savings pot: ${error.message}`);
    }
    return created;
  }

  /** Both currencies at once — a currency the user never configured comes
   * back as a default/disabled placeholder, no row created just for reading.
   * One round trip per currency (both run in parallel): the pot and ALL its
   * entries come back together via PostgREST's embedded-resource select,
   * instead of the pot, then the full entry list again for the balance, then
   * the last 20 again for display — three reads of the same table down to
   * one. The balance still needs every entry ever recorded (it's a running
   * ledger total, not just the recent ones shown in the UI). */
  async getMyPot(userId: string) {
    const pots = await Promise.all(
      CURRENCIES.map(async (currency) => {
        const { data: pot } = await this.db
          .from('savings_pots')
          .select('*, savings_pot_entries(*)')
          .eq('user_id', userId)
          .eq('currency', currency)
          .maybeSingle();

        if (!pot) {
          return { currency, pot: null, balance_cents: 0, entries: [] as any[] };
        }

        const { savings_pot_entries: allEntries, ...potFields } = pot as any;
        const entries = (allEntries || []).sort(
          (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
        const balance_cents = entries.reduce(
          (sum: number, e: any) => sum + (e.type === 'round_up' ? e.amount_cents : -e.amount_cents),
          0,
        );

        return { currency, pot: potFields, balance_cents, entries: entries.slice(0, 20) };
      }),
    );

    return { pots };
  }

  async updateSettings(
    userId: string,
    currency: string,
    dto: { round_up_enabled?: boolean; round_up_increment_cents?: number; goal_name?: string; goal_amount_cents?: number },
  ) {
    this.assertCurrency(currency);
    const pot = await this.getOrCreatePot(userId, currency);

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

  /** The free-anytime withdrawal, back to the caller's own main wallet, in
   * the SAME currency as the pot withdrawn from — a real money movement, so
   * it requires the PIN like transfer/payWithWallet. */
  async withdraw(userId: string, currency: string, amountCents: number, pin: string) {
    this.assertCurrency(currency);
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
      p_currency: currency,
      p_amount_cents: amountCents,
    });

    if (error) {
      throw new BadRequestException(error.message.includes('Insufficient') ? 'Solde de la tirelire insuffisant' : 'Échec du retrait');
    }

    return { currency, pot_balance_cents: newBalance };
  }

  /** Best-effort — called by WalletsService.transfer() and
   * PaymentsService.payWithWallet() strictly AFTER their own money movement
   * has already succeeded. Never throws: any failure (pot not enabled for
   * this currency, insufficient balance for the small extra amount, etc.)
   * just means no round-up happens this time — the triggering
   * payment/transfer is completely unaffected either way. Always rounds up
   * in the SAME currency as the payment — a USD payment can only ever grow
   * the USD pot, never CDF, and vice versa. */
  async maybeRoundUp(userId: string, walletId: string, amountCents: number, currency: string, reference: string) {
    if (!CURRENCIES.includes(currency as Currency)) return null;

    const { data: pot } = await this.db
      .from('savings_pots')
      .select('id, round_up_enabled, round_up_increment_cents')
      .eq('user_id', userId)
      .eq('currency', currency)
      .maybeSingle();

    if (!pot?.round_up_enabled || !pot.round_up_increment_cents) return null;

    const remainder = amountCents % pot.round_up_increment_cents;
    const delta = remainder === 0 ? 0 : pot.round_up_increment_cents - remainder;
    if (delta <= 0) return null;

    try {
      const { data: newBalance, error } = await this.db.rpc('round_up_to_savings', {
        p_wallet_id: walletId,
        p_user_id: userId,
        p_currency: currency,
        p_amount_cents: delta,
        p_reference: reference,
      });
      if (error) throw new Error(error.message);

      return { currency, amount_cents: delta, pot_balance_cents: newBalance };
    } catch (err: any) {
      this.logger.warn(`Round-up skipped for user ${userId} (${reference}): ${err.message}`);
      return null;
    }
  }
}
