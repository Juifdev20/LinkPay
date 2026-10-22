import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export interface CommissionResult {
  gross_cents: number;
  psp_fee_cents: number;
  platform_fee_cents: number;
  other_fees_cents: number;
  net_cents: number;
  total_fees_cents: number;
  total_cents: number;
  commission_rule_id: string | null;
}

@Injectable()
export class CommissionsService {
  private readonly logger = new Logger(CommissionsService.name);

  constructor(private supabaseService: SupabaseService) {}

  async calculateFees(
    amountCents: number,
    currency: string,
    merchantId: string,
    commissionModel: string,
  ): Promise<CommissionResult> {
    const rule = await this.getActiveRule(merchantId, currency);

    const pspFeeCents = this.estimatePspFee(amountCents);
    const platformFeeCents = this.calculateCommission(amountCents, rule);

    // Who bears the ScanLinkPay commission. SHARED: the merchant's half is fixed on the fee before any rounding below.
    let payerFeeCents =
      commissionModel === 'CUSTOMER_PAID' ? platformFeeCents
      : commissionModel === 'SHARED' ? platformFeeCents - Math.floor(platformFeeCents / 2)
      : 0;
    let merchantFeeCents = platformFeeCents - payerFeeCents;

    // Mobile Money / card providers (FlexPaie) only take whole currency units (see psp/amount-check.ts), so on a whole amount
    // the payer's share must be whole too. It is rounded DOWN and the few cents left go to the merchant: the payer never pays
    // more than the real commission. Rounding it UP (until 23/10/2026) turned a 0.05 USD commission into 1 USD — a 1 USD
    // subscription cost the payer 2 USD before FlexPaie's own fee. ScanLinkPay's commission does not change either way.
    if (payerFeeCents > 0 && amountCents % 100 === 0) {
      const wholePayerFee = Math.floor(payerFeeCents / 100) * 100;
      merchantFeeCents += payerFeeCents - wholePayerFee;
      payerFeeCents = wholePayerFee;
    }

    const netCents = amountCents - pspFeeCents - merchantFeeCents;
    const totalCents = amountCents + payerFeeCents;

    return {
      gross_cents: amountCents,
      psp_fee_cents: pspFeeCents,
      platform_fee_cents: platformFeeCents,
      other_fees_cents: 0,
      net_cents: Math.max(0, netCents),
      total_fees_cents: pspFeeCents + platformFeeCents,
      total_cents: totalCents,
      commission_rule_id: rule?.id || null,
    };
  }

  async calculateFeesPreview(
    amountCents: number,
    currency: string,
    merchantId: string,
    commissionModel: string,
  ): Promise<CommissionResult> {
    return this.calculateFees(amountCents, currency, merchantId, commissionModel);
  }

  private calculateCommission(amountCents: number, rule: any): number {
    if (!rule) return 0;

    const percentAmount = Math.floor(amountCents * parseFloat(rule.percent));
    let commission = percentAmount + (rule.fixed_cents || 0);

    if (rule.min_cents !== null && commission < rule.min_cents) {
      commission = rule.min_cents;
    }

    if (rule.max_cents !== null && commission > rule.max_cents) {
      commission = rule.max_cents;
    }

    return commission;
  }

  /**
   * What the payment provider costs the merchant. Zero with FlexPaie (and for wallet payments, which use no provider): FlexPaie
   * adds its own fee (about 2 %, 3 % by card) on top of what the PAYER is charged — 2.00 USD requested, 2.04 USD debited — and
   * credits the requested amount. Holding back an estimated 1.5 % from the merchant as well made that fee paid twice (23/10/2026).
   * The parameter stays for a provider that would bill the merchant instead.
   */
  private estimatePspFee(_amountCents: number): number {
    return 0;
  }

  private async getActiveRule(merchantId: string, currency: string): Promise<any> {
    const { data: merchant } = await this.supabaseService.getClient()
      .from('merchants')
      .select('commission_rule_id')
      .eq('id', merchantId)
      .single();

    if (merchant?.commission_rule_id) {
      const { data: rule } = await this.supabaseService.getClient()
        .from('commission_rules')
        .select('*')
        .eq('id', merchant.commission_rule_id)
        .eq('currency', currency)
        .eq('is_active', true)
        .single();
      if (rule) return rule;
    }

    // A merchant's pinned rule (commission_rule_id) is currency-agnostic by
    // design (one merchant, one preferred rule) — if it doesn't match the
    // currency being charged (e.g. pinned to a CDF rule but this payment is
    // in USD), fall through to the global rule for that currency below,
    // same as a merchant with no pinned rule at all.
    const { data: globalRule } = await this.supabaseService.getClient()
      .from('commission_rules')
      .select('*')
      .eq('applies_to', 'all')
      .eq('currency', currency)
      .eq('is_active', true)
      .order('valid_from', { ascending: false })
      .limit(1)
      .single();

    return globalRule;
  }

  async createRule(data: {
    name: string;
    description?: string;
    percent: string;
    fixed_cents?: number;
    min_cents?: number;
    max_cents?: number;
    applies_to?: string;
    target_id?: string;
    currency?: string;
  }, createdBy: string) {
    const { data: existingRules } = await this.supabaseService.getClient()
      .from('commission_rules')
      .select('version')
      .eq('applies_to', data.applies_to || 'all')
      .eq('target_id', data.target_id || null)
      .eq('currency', data.currency || 'CDF')
      .order('version', { ascending: false })
      .limit(1);

    const nextVersion = (existingRules?.[0]?.version || 0) + 1;

    const { data: rule, error } = await this.supabaseService.getClient()
      .from('commission_rules')
      .insert({
        ...data,
        currency: data.currency || 'CDF',
        version: nextVersion,
        is_active: true,
        valid_from: new Date().toISOString(),
        created_by: createdBy,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create commission rule: ${error.message}`);
    }

    return rule;
  }

  async listRules(filters?: { applies_to?: string; active_only?: boolean }) {
    let query = this.supabaseService.getClient()
      .from('commission_rules')
      .select('*')
      .order('created_at', { ascending: false });

    if (filters?.applies_to) {
      query = query.eq('applies_to', filters.applies_to);
    }
    if (filters?.active_only) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to list rules: ${error.message}`);
    return data;
  }

  async deactivateRule(ruleId: string) {
    const { data, error } = await this.supabaseService.getClient()
      .from('commission_rules')
      .update({
        is_active: false,
        valid_until: new Date().toISOString(),
      })
      .eq('id', ruleId)
      .select()
      .single();

    if (error) throw new NotFoundException('Commission rule not found');
    return data;
  }
}
