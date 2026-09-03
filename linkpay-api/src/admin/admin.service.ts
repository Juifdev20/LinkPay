import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class AdminService {
  constructor(private supabaseService: SupabaseService) {}

  async getDashboardStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { count: totalUsers } = await this.supabaseService.getClient()
      .from('profiles').select('*', { count: 'exact', head: true });

    const { count: totalMerchants } = await this.supabaseService.getClient()
      .from('merchants').select('*', { count: 'exact', head: true });

    const { count: activeMerchants } = await this.supabaseService.getClient()
      .from('merchants').select('*', { count: 'exact', head: true }).eq('status', 'active');

    const { count: totalTransactions } = await this.supabaseService.getClient()
      .from('transactions').select('*', { count: 'exact', head: true });

    const { count: todayTransactions } = await this.supabaseService.getClient()
      .from('transactions').select('*', { count: 'exact', head: true }).gte('created_at', today.toISOString());

    const { data: volumeData } = await this.supabaseService.getClient()
      .from('transactions').select('amount_cents, net_cents').eq('status', 'SUCCESS');

    const totalVolume = volumeData?.reduce((s: number, t: any) => s + t.amount_cents, 0) || 0;
    const totalNet = volumeData?.reduce((s: number, t: any) => s + t.net_cents, 0) || 0;

    const { count: pendingSettlements } = await this.supabaseService.getClient()
      .from('settlements').select('*', { count: 'exact', head: true }).eq('status', 'PENDING');

    const { count: pendingMerchants } = await this.supabaseService.getClient()
      .from('merchants').select('*', { count: 'exact', head: true }).eq('status', 'pending');

    return {
      total_users: totalUsers || 0,
      total_merchants: totalMerchants || 0,
      active_merchants: activeMerchants || 0,
      pending_merchants: pendingMerchants || 0,
      total_transactions: totalTransactions || 0,
      today_transactions: todayTransactions || 0,
      total_volume_cents: totalVolume,
      total_net_cents: totalNet,
      total_commission_cents: totalVolume - totalNet,
      pending_settlements: pendingSettlements || 0,
    };
  }

  async listMerchants(filters?: { status?: string; page?: number; limit?: number }) {
    let query = this.supabaseService.getClient()
      .from('merchants').select('*', { count: 'exact' }).order('created_at', { ascending: false });

    if (filters?.status) query = query.eq('status', filters.status);

    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    query = query.range((page - 1) * limit, page * limit - 1);

    const { data, error, count } = await query;
    if (error) throw new Error(`Failed to fetch merchants: ${error.message}`);
    return { data, total: count || 0, page, limit };
  }

  async updateMerchantStatus(id: string, status: string, notes?: string) {
    const { data, error } = await this.supabaseService.getClient()
      .from('merchants')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new NotFoundException('Merchant not found');
    return data;
  }

  async listUsers(filters?: { page?: number; limit?: number }) {
    let query = this.supabaseService.getClient()
      .from('profiles').select('*', { count: 'exact' }).order('created_at', { ascending: false });

    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    query = query.range((page - 1) * limit, page * limit - 1);

    const { data, error, count } = await query;
    if (error) throw new Error(`Failed to fetch users: ${error.message}`);

    const ids = (data || []).map((u: any) => u.id);
    let rolesByUser: Record<string, string> = {};

    if (ids.length) {
      const { data: userRoles } = await this.supabaseService.getClient()
        .from('user_roles')
        .select('user_id, role:roles(slug)')
        .in('user_id', ids);

      rolesByUser = (userRoles || []).reduce((acc: Record<string, string>, ur: any) => {
        acc[ur.user_id] = ur.role?.slug || 'client';
        return acc;
      }, {});
    }

    const enriched = (data || []).map((u: any) => ({ ...u, role: rolesByUser[u.id] || 'client' }));

    return { data: enriched, total: count || 0, page, limit };
  }

  async resetUserSession(userId: string) {
    const { error } = await this.supabaseService.getClient()
      .from('profiles')
      .update({ active_session_id: null })
      .eq('id', userId);

    if (error) {
      throw new Error(`Failed to reset session: ${error.message}`);
    }

    return { success: true };
  }

  async assignRole(userId: string, roleSlug: string, merchantId?: string) {
    const { data: role } = await this.supabaseService.getClient()
      .from('roles').select('id').eq('slug', roleSlug).single();

    if (!role) throw new NotFoundException(`Role "${roleSlug}" not found`);

    // The JWT model only supports one "current" role per user — replace any
    // prior row(s) instead of accumulating, otherwise role lookups become
    // ambiguous (.single() fails and silently falls back to 'client').
    await this.supabaseService.getClient().from('user_roles').delete().eq('user_id', userId);

    const { data, error } = await this.supabaseService.getClient()
      .from('user_roles')
      .insert({
        user_id: userId,
        role_id: role.id,
        merchant_id: merchantId || null,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to assign role: ${error.message}`);
    return data;
  }
}
