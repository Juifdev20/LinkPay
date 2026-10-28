import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { normalizeDrcPhone, phoneLikePattern, samePhone } from '../auth/phone';
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
  'two_factor_last_step', 'two_factor_recovery_hashes',
  'app_code_hash', 'app_code_attempts', 'app_code_lockouts', 'app_code_locked_until',
  'recovery_code_hash',
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

    // Enterprise staff: the station they work in (organization_staff.merchant_id), for their screens.
    let station: { id: string; name: string } | null = null;
    if (organizationId) {
      const { data: staffRow } = await this.supabaseService.getClient()
        .from('organization_staff')
        .select('merchant:merchants(id, name)')
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .maybeSingle();
      station = ((staffRow as any)?.merchant as { id: string; name: string } | null) || null;
    }

    // The face shown in the app: a personal photo (clients, merchants) or, for everyone who works in a company
    // (owner and staff), the company logo, which only its managers change.
    const companyId = actingAsOrgId || organizationId || null;
    let face: { avatar_url: string | null; avatar_kind: 'photo' | 'logo' } = { avatar_url: data.avatar_url ?? null, avatar_kind: 'photo' };
    if (companyId || role === 'enterprise') {
      const query = this.supabaseService.getClient().from('organizations').select('logo_url');
      const { data: org } = await (companyId ? query.eq('id', companyId) : query.eq('owner_id', userId).limit(1)).maybeSingle();
      face = { avatar_url: (org as any)?.logo_url ?? null, avatar_kind: 'logo' };
    }

    return {
      ...toPublicProfile(data),
      ...face,
      // Whether the access code was chosen (the hash itself never leaves the server).
      has_app_code: !!data.app_code_hash,
      role,
      merchant_id: merchantId || undefined,
      acting_as_org_id: actingAsOrgId || undefined,
      organization_id: organizationId || undefined,
      station_id: station?.id,
      station_name: station?.name,
    };
  }

  async updateProfile(userId: string, updates: Record<string, any>) {
    // The profile photo is NOT here: it only comes from PUT /users/me/avatar (a picture the API shrank and stored itself),
    // never from a link the caller typed.
    const allowedFields = ['phone', 'full_name'];
    const filtered: Record<string, any> = {};

    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        filtered[key] = updates[key];
      }
    }

    // The phone number is how people log in: always stored the same way, and never one another account uses.
    if ('phone' in filtered) {
      const phone = normalizeDrcPhone(filtered.phone);
      if (!phone) throw new BadRequestException('Numéro de téléphone invalide : +243 suivi de 9 chiffres.');
      const { data: owners } = await this.supabaseService.getClient()
        .from('profiles').select('id, phone').like('phone', phoneLikePattern(phone)).limit(10);
      if ((owners || []).some((o) => o.id !== userId && samePhone(o.phone, phone))) {
        throw new ConflictException('Ce numéro de téléphone est déjà utilisé par un autre compte');
      }
      filtered.phone = phone;
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
