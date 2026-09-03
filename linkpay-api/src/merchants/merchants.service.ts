import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class MerchantsService {
  constructor(
    private supabaseService: SupabaseService,
    private authService: AuthService,
  ) {}

  async createMerchant(ownerId: string, email: string, data: {
    name: string;
    legal_name?: string;
    phone?: string;
    email?: string;
    address?: string;
    city?: string;
  }) {
    const { data: merchant, error } = await this.supabaseService.getClient()
      .from('merchants')
      .insert({
        ...data,
        owner_id: ownerId,
        status: 'pending',
        country: 'CD',
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create merchant: ${error.message}`);
    }

    const { data: role } = await this.supabaseService.getClient()
      .from('roles')
      .select('id')
      .eq('slug', 'merchant')
      .single();

    if (role) {
      await this.supabaseService.getClient().from('merchant_users').insert({
        merchant_id: merchant.id,
        user_id: ownerId,
        role_id: role.id,
        status: 'active',
      });

      // Elevate the global role too — RolesGuard reads role only from the JWT,
      // not from merchant_users, so without this the user stays "client" everywhere else.
      // The JWT model only supports one "current" role per user, so replace any
      // prior row(s) instead of accumulating — a leftover 'client' row alongside
      // this new 'merchant' one would make role lookups ambiguous (.single()
      // fails and silently falls back to 'client' on login/refresh).
      await this.supabaseService.getClient().from('user_roles').delete().eq('user_id', ownerId);
      await this.supabaseService.getClient().from('user_roles').insert({
        user_id: ownerId,
        role_id: role.id,
        merchant_id: merchant.id,
      });
    }

    const access_token = await this.authService.generateToken(ownerId, email, 'merchant', merchant.id);

    return { merchant, access_token };
  }

  async getMerchantById(id: string) {
    const { data, error } = await this.supabaseService.getClient()
      .from('merchants')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException('Merchant not found');
    }

    return data;
  }

  async getMerchantByOwner(ownerId: string) {
    const { data, error } = await this.supabaseService.getClient()
      .from('merchants')
      .select('*')
      .eq('owner_id', ownerId)
      .single();

    if (error || !data) {
      throw new NotFoundException('No merchant account found');
    }

    return data;
  }

  async updateMerchant(id: string, updates: Record<string, any>) {
    const allowedFields = [
      'name', 'legal_name', 'phone', 'email', 'address', 'city',
      'settlement_account', 'limits', 'status', 'commission_rule_id',
    ];
    const filtered: Record<string, any> = {};

    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        filtered[key] = updates[key];
      }
    }

    const { data, error } = await this.supabaseService.getClient()
      .from('merchants')
      .update({ ...filtered, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update merchant: ${error.message}`);
    }

    return data;
  }

  async getMerchantUsers(merchantId: string) {
    const { data, error } = await this.supabaseService.getClient()
      .from('merchant_users')
      .select('id, user_id, status, created_at, role:roles(slug, name)')
      .eq('merchant_id', merchantId);

    if (error) {
      throw new Error(`Failed to fetch merchant users: ${error.message}`);
    }

    // merchant_users.user_id references auth.users, not profiles, so
    // PostgREST can't embed profiles directly — join manually instead.
    const userIds = (data || []).map((mu: any) => mu.user_id);
    let profilesById: Record<string, any> = {};

    if (userIds.length) {
      const { data: profiles } = await this.supabaseService.getClient()
        .from('profiles')
        .select('id, full_name, email, phone')
        .in('id', userIds);

      profilesById = (profiles || []).reduce((acc: Record<string, any>, p: any) => {
        acc[p.id] = p;
        return acc;
      }, {});
    }

    return (data || []).map((mu: any) => ({
      ...mu,
      user: profilesById[mu.user_id] || null,
    }));
  }

  async addMerchantUser(merchantId: string, data: { email: string }) {
    const { data: targetUser } = await this.supabaseService.getClient()
      .from('profiles')
      .select('id')
      .ilike('email', data.email)
      .single();

    if (!targetUser) {
      throw new NotFoundException("Aucun compte LinkPay avec cet email — la personne doit d'abord créer un compte.");
    }

    const { data: role } = await this.supabaseService.getClient()
      .from('roles')
      .select('id')
      .eq('slug', 'cashier')
      .single();

    if (!role) {
      throw new NotFoundException('Role "cashier" not found');
    }

    const { data: merchantUser, error } = await this.supabaseService.getClient()
      .from('merchant_users')
      .insert({
        merchant_id: merchantId,
        user_id: targetUser.id,
        role_id: role.id,
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to add merchant user: ${error.message}`);
    }

    // Elevate the invited user's global role too (replace, not accumulate —
    // the JWT model only supports one role at a time). They'll pick this up
    // on their next login or /auth/refresh cycle.
    await this.supabaseService.getClient().from('user_roles').delete().eq('user_id', targetUser.id);
    await this.supabaseService.getClient().from('user_roles').insert({
      user_id: targetUser.id,
      role_id: role.id,
      merchant_id: merchantId,
    });

    return merchantUser;
  }

  async removeMerchantUser(merchantId: string, userId: string) {
    const { error } = await this.supabaseService.getClient()
      .from('merchant_users')
      .delete()
      .eq('merchant_id', merchantId)
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Failed to remove merchant user: ${error.message}`);
    }

    const { data: clientRole } = await this.supabaseService.getClient()
      .from('roles')
      .select('id')
      .eq('slug', 'client')
      .single();

    if (clientRole) {
      await this.supabaseService.getClient().from('user_roles').delete().eq('user_id', userId);
      await this.supabaseService.getClient().from('user_roles').insert({
        user_id: userId,
        role_id: clientRole.id,
      });
    }

    return { success: true };
  }

  async getMerchantStats(merchantId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { count: totalTransactions } = await this.supabaseService.getClient()
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('merchant_id', merchantId);

    const { count: todayTransactions } = await this.supabaseService.getClient()
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('merchant_id', merchantId)
      .gte('created_at', today.toISOString());

    const { data: volumeData } = await this.supabaseService.getClient()
      .from('transactions')
      .select('amount_cents, net_cents')
      .eq('merchant_id', merchantId)
      .eq('status', 'SUCCESS');

    const totalVolume = volumeData?.reduce((sum: number, t: any) => sum + (t.amount_cents || 0), 0) || 0;
    const totalNet = volumeData?.reduce((sum: number, t: any) => sum + (t.net_cents || 0), 0) || 0;

    const { data: pendingData, count: pendingCount } = await this.supabaseService.getClient()
      .from('transactions')
      .select('amount_cents', { count: 'exact' })
      .eq('merchant_id', merchantId)
      .in('status', ['PENDING', 'PROCESSING']);

    const pendingCents = pendingData?.reduce((sum: number, t: any) => sum + (t.amount_cents || 0), 0) || 0;

    const { count: failedCount } = await this.supabaseService.getClient()
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('merchant_id', merchantId)
      .eq('status', 'FAILED');

    return {
      total_transactions: totalTransactions || 0,
      today_transactions: todayTransactions || 0,
      total_volume_cents: totalVolume,
      total_net_cents: totalNet,
      pending_count: pendingCount || 0,
      pending_cents: pendingCents,
      failed_count: failedCount || 0,
    };
  }
}
