import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export type WalletOpType = 'TRANSFER' | 'WITHDRAWAL' | 'WALLET_PAYMENT';

const ENTRY_TYPE_BY_OP: Record<WalletOpType, string> = {
  TRANSFER: 'TRANSFER_OUT',
  WITHDRAWAL: 'WITHDRAWAL',
  WALLET_PAYMENT: 'PAYMENT',
};

export interface FeeQuote {
  fee_cents: number;
  amount_cents: number;
  total_cents: number;
}

/**
 * Reads limits/fees from `wallet_limits` (never hardcoded in the frontend or
 * baked into application code, per the master prompt) and enforces them
 * server-side before any transfer/withdrawal/wallet-payment executes. Only
 * a single global row per op_type exists today (applies_to = 'all') — a
 * future per-user/per-KYC-tier override would add rows the caller checks
 * first, not built yet.
 */
@Injectable()
export class WalletLimitsService {
  constructor(private supabaseService: SupabaseService) {}

  async getRule(opType: WalletOpType, currency: string) {
    const { data } = await this.supabaseService.getClient()
      .from('wallet_limits')
      .select('*')
      .eq('op_type', opType)
      .eq('applies_to', 'all')
      .eq('currency', currency)
      .eq('is_active', true)
      .single();
    return data;
  }

  /** Computes the fee for an operation and returns the quote — never trust a fee sent by the frontend. */
  quoteFee(amountCents: number, rule: any): FeeQuote {
    if (!rule) return { fee_cents: 0, amount_cents: amountCents, total_cents: amountCents };
    const feeCents = Math.round(amountCents * parseFloat(rule.fee_percent || '0')) + (rule.fee_fixed_cents || 0);
    return { fee_cents: feeCents, amount_cents: amountCents, total_cents: amountCents + feeCents };
  }

  /**
   * Validates amountCents against min/max and daily/monthly caps for this
   * wallet, throwing a clear BadRequestException if any is exceeded. Caps
   * are computed from the actual ledger history (sum of matching debit
   * entries in the window), not a cached counter, so it's always accurate.
   */
  async assertWithinLimits(walletId: string, opType: WalletOpType, amountCents: number, rule: any) {
    if (!rule) return;

    if (rule.min_cents && amountCents < rule.min_cents) {
      throw new BadRequestException(`Montant minimum : ${(rule.min_cents / 100).toLocaleString('fr-FR')} ${rule.currency}`);
    }
    if (rule.max_cents && amountCents > rule.max_cents) {
      throw new BadRequestException(`Montant maximum par opération : ${(rule.max_cents / 100).toLocaleString('fr-FR')} ${rule.currency}`);
    }

    const entryType = ENTRY_TYPE_BY_OP[opType];

    if (rule.daily_max_cents) {
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      const sum = await this.sumDebits(walletId, entryType, since);
      if (sum + amountCents > rule.daily_max_cents) {
        throw new BadRequestException(
          `Limite quotidienne dépassée (${(rule.daily_max_cents / 100).toLocaleString('fr-FR')} ${rule.currency} max/jour).`,
        );
      }
    }

    if (rule.monthly_max_cents) {
      const since = new Date();
      since.setDate(1);
      since.setHours(0, 0, 0, 0);
      const sum = await this.sumDebits(walletId, entryType, since);
      if (sum + amountCents > rule.monthly_max_cents) {
        throw new BadRequestException(
          `Limite mensuelle dépassée (${(rule.monthly_max_cents / 100).toLocaleString('fr-FR')} ${rule.currency} max/mois).`,
        );
      }
    }
  }

  private async sumDebits(walletId: string, entryType: string, since: Date): Promise<number> {
    const { data } = await this.supabaseService.getClient()
      .from('ledger_entries')
      .select('amount_cents')
      .eq('wallet_id', walletId)
      .eq('entry_type', entryType)
      .eq('direction', 'debit')
      .gte('created_at', since.toISOString());

    return (data || []).reduce((sum: number, e: any) => sum + e.amount_cents, 0);
  }
}
