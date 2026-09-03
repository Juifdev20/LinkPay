import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class UsersService {
  constructor(private supabaseService: SupabaseService) {}

  async getProfile(userId: string) {
    const { data, error } = await this.supabaseService.getClient()
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !data) {
      throw new NotFoundException('Profile not found');
    }

    const { data: roleData } = await this.supabaseService.getClient()
      .from('user_roles')
      .select('role:roles(slug), merchant_id')
      .eq('user_id', userId)
      .single();

    return {
      ...data,
      role: (roleData?.role as any)?.slug || 'client',
      merchant_id: roleData?.merchant_id || undefined,
    };
  }

  async updateProfile(userId: string, updates: Record<string, any>) {
    const allowedFields = ['phone', 'full_name', 'avatar_url'];
    const filtered: Record<string, any> = {};

    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        filtered[key] = updates[key];
      }
    }

    const { data, error } = await this.supabaseService.getClient()
      .from('profiles')
      .update({ ...filtered, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update profile: ${error.message}`);
    }

    return data;
  }

  async getClientStats(userId: string) {
    const { data, count } = await this.supabaseService.getClient()
      .from('transactions')
      .select('amount_cents', { count: 'exact' })
      .eq('client_id', userId)
      .eq('status', 'SUCCESS');

    const totalSpent = data?.reduce((sum: number, t: any) => sum + (t.amount_cents || 0), 0) || 0;

    return {
      total_spent_cents: totalSpent,
      total_payments: count || 0,
    };
  }

  async getUserRoles(userId: string) {
    const { data, error } = await this.supabaseService.getClient()
      .from('user_roles')
      .select('role:roles(*), merchant_id, org_id')
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Failed to fetch roles: ${error.message}`);
    }

    return data;
  }
}
