import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { LedgerService } from '../ledger/ledger.service';

@Injectable()
export class SettlementsService {
  private readonly logger = new Logger(SettlementsService.name);

  constructor(
    private supabaseService: SupabaseService,
    private ledgerService: LedgerService,
  ) {}

  /**
   * Groups unsettled transactions by their actual currency and creates one
   * settlement row per currency present in the period — never a single row
   * mixing CDF and USD revenue together under a hardcoded currency.
   */
  async createSettlement(merchantId: string, data?: {
    period_start?: string;
    period_end?: string;
  }) {
    const periodEnd = data?.period_end || new Date().toISOString();
    const periodStart = data?.period_start || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: transactions, error } = await this.supabaseService.getClient()
      .from('transactions')
      .select('id, amount_cents, psp_fee_cents, platform_fee_cents, net_cents, currency')
      .eq('merchant_id', merchantId)
      .eq('status', 'SUCCESS')
      .is('settlement_id', null)
      .gte('created_at', periodStart)
      .lte('created_at', periodEnd);

    if (error) throw new Error(`Failed to fetch unsettled transactions: ${error.message}`);

    if (!transactions || transactions.length === 0) {
      throw new NotFoundException('No unsettled transactions found for this period');
    }

    const byCurrency = new Map<string, any[]>();
    for (const t of transactions) {
      const key = t.currency || 'CDF';
      if (!byCurrency.has(key)) byCurrency.set(key, []);
      byCurrency.get(key)!.push(t);
    }

    const settlements: any[] = [];

    for (const [currency, txs] of byCurrency) {
      const grossCents = txs.reduce((sum: number, t: any) => sum + t.amount_cents, 0);
      const pspFees = txs.reduce((sum: number, t: any) => sum + t.psp_fee_cents, 0);
      const platformFees = txs.reduce((sum: number, t: any) => sum + t.platform_fee_cents, 0);
      const netCents = txs.reduce((sum: number, t: any) => sum + t.net_cents, 0);

      const reference = `STL-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

      const { data: settlement, error: settlementError } = await this.supabaseService.getClient()
        .from('settlements')
        .insert({
          merchant_id: merchantId,
          period_start: periodStart,
          period_end: periodEnd,
          gross_cents: grossCents,
          psp_fees_cents: pspFees,
          platform_fees_cents: platformFees,
          net_cents: netCents,
          currency,
          status: 'PENDING',
          reference,
          transaction_count: txs.length,
        })
        .select()
        .single();

      if (settlementError) {
        throw new Error(`Failed to create settlement: ${settlementError.message}`);
      }

      const txIds = txs.map((t: any) => t.id);
      await this.supabaseService.getClient()
        .from('transactions')
        .update({ settlement_id: settlement.id })
        .in('id', txIds);

      await this.ledgerService.writeSettlementEntry(settlement);

      this.logger.log(`Settlement created: ${reference} for ${txs.length} transactions, net=${netCents} ${currency}`);
      settlements.push(settlement);
    }

    return settlements;
  }

  async getMerchantBalance(merchantId: string) {
    const { data: unsettled } = await this.supabaseService.getClient()
      .from('transactions')
      .select('net_cents, currency')
      .eq('merchant_id', merchantId)
      .eq('status', 'SUCCESS')
      .is('settlement_id', null);

    const available = { CDF: 0, USD: 0 };
    for (const t of unsettled || []) {
      const key = t.currency === 'USD' ? 'USD' : 'CDF';
      available[key] += t.net_cents || 0;
    }

    const { data: pendingSettlements } = await this.supabaseService.getClient()
      .from('settlements')
      .select('net_cents, currency')
      .eq('merchant_id', merchantId)
      .in('status', ['PENDING', 'PROCESSING']);

    const pending = { CDF: 0, USD: 0 };
    for (const s of pendingSettlements || []) {
      const key = s.currency === 'USD' ? 'USD' : 'CDF';
      pending[key] += s.net_cents || 0;
    }

    return { available, pending };
  }

  async getSettlementById(id: string) {
    const { data, error } = await this.supabaseService.getClient()
      .from('settlements')
      .select('*, merchant:merchants(name)')
      .eq('id', id)
      .single();

    if (error || !data) throw new NotFoundException('Settlement not found');
    return data;
  }

  async getMerchantSettlements(merchantId: string, filters?: { status?: string; page?: number; limit?: number }) {
    let query = this.supabaseService.getClient()
      .from('settlements')
      .select('*', { count: 'exact' })
      .eq('merchant_id', merchantId)
      .order('created_at', { ascending: false });

    if (filters?.status) query = query.eq('status', filters.status);

    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    query = query.range((page - 1) * limit, page * limit - 1);

    const { data, error, count } = await query;
    if (error) throw new Error(`Failed to fetch settlements: ${error.message}`);
    return { data, total: count || 0, page, limit };
  }

  async updateSettlementStatus(id: string, status: string, notes?: string) {
    const updates: Record<string, any> = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (status === 'COMPLETED') updates.completed_at = new Date().toISOString();
    if (notes) updates.notes = notes;

    const { data, error } = await this.supabaseService.getClient()
      .from('settlements')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new NotFoundException('Settlement not found');
    return data;
  }

  async getAllSettlements(filters?: { status?: string; page?: number; limit?: number }) {
    let query = this.supabaseService.getClient()
      .from('settlements')
      .select('*, merchant:merchants(name)', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (filters?.status) query = query.eq('status', filters.status);

    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    query = query.range((page - 1) * limit, page * limit - 1);

    const { data, error, count } = await query;
    if (error) throw new Error(`Failed to fetch settlements: ${error.message}`);
    return { data, total: count || 0, page, limit };
  }
}
