import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class SettlementsService {
  private readonly logger = new Logger(SettlementsService.name);

  constructor(
    private supabaseService: SupabaseService,
  ) {}

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
