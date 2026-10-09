import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export type WalletOpType = 'TRANSFER' | 'WITHDRAWAL' | 'WALLET_PAYMENT';

const ENTRY_TYPE_BY_OP: Record<WalletOpType, string> = {
  TRANSFER: 'TRANSFER_OUT',
  WITHDRAWAL: 'WITHDRAWAL',
  WALLET_PAYMENT: 'PAYMENT',
};

/** What an admin may change on a rule. op_type / currency identify it and never change. */
export const EDITABLE_FIELDS = [
  'fee_percent', 'fee_fixed_cents', 'min_cents', 'max_cents', 'daily_max_cents', 'monthly_max_cents', 'is_active',
] as const;

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

  /** All global rules, for the admin screen. */
  async listRules() {
    const { data, error } = await this.supabaseService.getClient()
      .from('wallet_limits')
      .select('*')
      .eq('applies_to', 'all')
      .order('op_type', { ascending: true })
      .order('currency', { ascending: true });
    if (error) throw new Error(`Failed to list wallet limits: ${error.message}`);
    return data || [];
  }

  /**
   * Updates the fee / caps of one rule. `null` on a cap removes it (no limit);
   * a field left out is unchanged. Returns the rule before and after, so the
   * caller can audit exactly what an admin changed.
   */
  async updateRule(id: string, changes: Partial<Record<(typeof EDITABLE_FIELDS)[number], number | boolean | null>>) {
    const db = this.supabaseService.getClient();
    const { data: before } = await db.from('wallet_limits').select('*').eq('id', id).maybeSingle();
    if (!before) throw new NotFoundException('Règle introuvable');

    const updates: Record<string, any> = {};
    for (const field of EDITABLE_FIELDS) {
      if (changes[field] !== undefined) updates[field] = changes[field];
    }

    const merged = { ...before, ...updates };
    if (merged.max_cents != null && merged.min_cents != null && merged.min_cents > merged.max_cents) {
      throw new BadRequestException('Le minimum ne peut pas dépasser le maximum par opération.');
    }
    if (merged.daily_max_cents != null && merged.max_cents != null && merged.daily_max_cents < merged.max_cents) {
      throw new BadRequestException('La limite quotidienne ne peut pas être inférieure au maximum par opération.');
    }
    if (merged.monthly_max_cents != null && merged.daily_max_cents != null && merged.monthly_max_cents < merged.daily_max_cents) {
      throw new BadRequestException('La limite mensuelle ne peut pas être inférieure à la limite quotidienne.');
    }

    const { data: after, error } = await db
      .from('wallet_limits')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error || !after) throw new Error(`Failed to update wallet limit: ${error?.message}`);
    return { before, after };
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
