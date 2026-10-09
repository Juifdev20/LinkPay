import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { sumByCurrency } from '../common/utils/currency';

/**
 * Columns of `profiles` that only the API itself may see. A profile is sent
 * to the browser (GET /users/me), and a bcrypt hash of a 4-digit PIN falls to
 * offline guessing in seconds — so the PIN hash, the 2FA secret and the
 * lockout / session-control columns never leave the server.
 */
const PROFILE_PRIVATE_FIELDS = [
  'transaction_pin_hash', 'pin_attempts', 'pin_locked_until',
  'two_factor_secret', 'active_session_id', 'active_device_id',
] as const;

export function toPublicProfile<T extends Record<string, any>>(row: T) {
  const publicRow: Record<string, any> = { ...row };
  for (const field of PROFILE_PRIVATE_FIELDS) delete publicRow[field];
  return publicRow;
}

@Injectable()
export class UsersService {
  constructor(private supabaseService: SupabaseService) {}

  /**
   * role/merchant_id/actingAsOrgId come from the caller's JWT (already
   * validated by JwtStrategy), not re-derived from user_roles here — an
   * enterprise owner "acting as" one of their stores has a token whose
   * role/merchant_id deliberately disagree with their canonical user_roles
   * row (which stays 'enterprise'). Re-deriving from the DB on every call
   * (this runs on every app mount via fetchProfile()) would silently reset
   * them back to enterprise scope. For every other account type, token and
   * canonical DB state are always in sync at issuance time anyway, so this
   * is a no-op behavior change for them — and one fewer DB round trip.
   */
  async getProfile(userId: string, role: string, merchantId?: string, actingAsOrgId?: string, organizationId?: string) {
    const { data, error } = await this.supabaseService.getClient()
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !data) {
      throw new NotFoundException('Profile not found');
    }

    return {
      ...toPublicProfile(data),
      role,
      merchant_id: merchantId || undefined,
      acting_as_org_id: actingAsOrgId || undefined,
      organization_id: organizationId || undefined,
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

    return toPublicProfile(data);
  }

  async getClientStats(userId: string) {
    const { data, count } = await this.supabaseService.getClient()
      .from('transactions')
      .select('amount_cents, currency', { count: 'exact' })
      .eq('client_id', userId)
      .eq('status', 'SUCCESS');

    return {
      // Independent per-currency figures — never summed together.
      spent: sumByCurrency(data, 'amount_cents'),
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
