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

    let netCents: number;
    let totalCents: number;

    switch (commissionModel) {
      case 'MERCHANT_PAID':
        netCents = amountCents - pspFeeCents - platformFeeCents;
        totalCents = amountCents;
        break;
      case 'CUSTOMER_PAID':
        netCents = amountCents - pspFeeCents;
        totalCents = amountCents + platformFeeCents;
        break;
      case 'SHARED':
        const merchantShare = Math.floor(platformFeeCents / 2);
        netCents = amountCents - pspFeeCents - merchantShare;
        totalCents = amountCents + (platformFeeCents - merchantShare);
        break;
      default:
        netCents = amountCents - pspFeeCents - platformFeeCents;
        totalCents = amountCents;
    }

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

  private estimatePspFee(amountCents: number): number {
    return Math.floor(amountCents * 0.015);
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
