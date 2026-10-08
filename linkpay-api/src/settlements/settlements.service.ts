import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class SettlementsService {
  private readonly logger = new Logger(SettlementsService.name);

  constructor(
    private supabaseService: SupabaseService,
  ) {}

  /**
   * Settles every unsettled transaction of the merchant — one settlement row
   * per currency. Done by create_merchant_settlements() (migration 040) in a
   * single locked database transaction: doing it here as read → insert →
   * tag let a double tap create two settlements paying the same money twice.
   * Earlier versions also only took the last 7 days by default, leaving
   * older money visible in the balance but impossible to request.
   */
  async createSettlement(merchantId: string) {
    const { data: merchant, error: merchantError } = await this.supabaseService.getClient()
      .from('merchants')
      .select('settlement_account')
      .eq('id', merchantId)
      .single();

    if (merchantError || !merchant) {
      throw new NotFoundException('Merchant not found');
    }

    if (!merchant.settlement_account?.number) {
      throw new BadRequestException(
        'Renseignez d\'abord votre compte de versement (numéro Mobile Money ou compte bancaire) pour recevoir vos règlements.',
      );
    }

    const { data: settlements, error } = await this.supabaseService.getClient()
      .rpc('create_merchant_settlements', {
        p_merchant_id: merchantId,
        p_payout_account: merchant.settlement_account,
      });

    if (error) throw new Error(`Failed to create settlement: ${error.message}`);

    if (!settlements || settlements.length === 0) {
      throw new NotFoundException('Aucune transaction à régler pour le moment');
    }

    for (const settlement of settlements) {
      this.logger.log(`Settlement created: ${settlement.reference} for ${settlement.transaction_count} transactions, net=${settlement.net_cents} ${settlement.currency}`);
    }

    return settlements;
  }

  /**
   * Same rules as create_merchant_settlements(): a partially refunded
   * transaction counts for its net minus what was refunded, and one with a
   * refund still pending at the PSP waits for the next settlement.
   */
  async getMerchantBalance(merchantId: string) {
    const { data: unsettled } = await this.supabaseService.getClient()
      .from('transactions')
      .select('id, net_cents, currency, refunds(amount_cents, status)')
      .eq('merchant_id', merchantId)
      .in('status', ['SUCCESS', 'PARTIALLY_REFUNDED'])
      .is('settlement_id', null);

    const available = { CDF: 0, USD: 0 };
    for (const t of unsettled || []) {
      const refunds: any[] = (t as any).refunds || [];
      if (refunds.some((r) => r.status === 'PENDING')) continue;
      const refunded = refunds
        .filter((r) => r.status === 'COMPLETED')
        .reduce((sum, r) => sum + (r.amount_cents || 0), 0);
      const key = t.currency === 'USD' ? 'USD' : 'CDF';
      available[key] += Math.max((t.net_cents || 0) - refunded, 0);
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

  /**
   * PENDING → PROCESSING → COMPLETED, or PENDING/PROCESSING → FAILED. Any
   * other move (e.g. reopening a COMPLETED payout) is refused. FAILED goes
   * through fail_settlement() so the transactions return to the merchant's
   * available balance instead of staying tied to a payout that never happened.
   */
  async updateSettlementStatus(id: string, status: string, notes?: string) {
    if (status === 'FAILED') {
      const { data, error } = await this.supabaseService.getClient()
        .rpc('fail_settlement', { p_settlement_id: id, p_notes: notes ?? null })
        .single();
      if (error || !data) {
        throw new BadRequestException('Ce règlement est introuvable ou ne peut plus être marqué en échec');
      }
      return data;
    }

    const fromStatus = SettlementsService.PREVIOUS_STATUS[status];
    if (!fromStatus) {
      throw new BadRequestException(`Statut invalide : ${status}`);
    }

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
      .eq('status', fromStatus)
      .select()
      .single();

    if (error || !data) {
      throw new BadRequestException(`Ce règlement est introuvable ou n'est pas au statut ${fromStatus}`);
    }
    return data;
  }

  private static readonly PREVIOUS_STATUS: Record<string, string> = {
    PROCESSING: 'PENDING',
    COMPLETED: 'PROCESSING',
  };

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
