import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { AuthService } from '../auth/auth.service';
import { sumByCurrency } from '../common/utils/currency';

@Injectable()
export class MerchantsService {
  constructor(
    private supabaseService: SupabaseService,
    private authService: AuthService,
  ) {}

  async createMerchant(
    ownerId: string,
    email: string,
    data: {
      name: string;
      legal_name?: string;
      phone?: string;
      email?: string;
      address?: string;
      city?: string;
      default_currency?: string;
    },
    options?: { organizationId?: string; elevateCallerRole?: boolean },
  ) {
    // Default true — the normal client-becomes-merchant upgrade path (the
    // only caller before organizations existed). An enterprise owner
    // creating a store under their org passes elevateCallerRole: false —
    // their canonical role must stay 'enterprise', only a merchant_users
    // row is added, exactly the multi-tenant-per-merchant mechanism below.
    const elevateCallerRole = options?.elevateCallerRole ?? true;

    const { data: merchant, error } = await this.supabaseService.getClient()
      .from('merchants')
      .insert({
        ...data,
        default_currency: data.default_currency || 'CDF',
        owner_id: ownerId,
        // Merchants go live immediately, same as a client — only
        // organizations (enterprise accounts) require admin approval.
        status: 'active',
        country: 'CD',
        organization_id: options?.organizationId || null,
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

      if (elevateCallerRole) {
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
    }

    const access_token = elevateCallerRole
      ? await this.authService.generateToken(ownerId, email, 'merchant', merchant.id)
      : undefined;

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
      'settlement_account', 'status', 'commission_rule_id', 'default_currency',
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

  /**
   * Invites an existing user as cashier. Only a plain client account can be
   * invited: adding a cashier replaces the person's global role, so inviting
   * an admin, another store's owner or another store's cashier used to strip
   * them of their own access (any merchant could demote a super_admin just by
   * knowing their email).
   */
  async addMerchantUser(merchantId: string, ownerId: string, data: { email: string }) {
    const { data: targetUser } = await this.supabaseService.getClient()
      .from('profiles')
      .select('id')
      .ilike('email', data.email)
      .single();

    if (!targetUser) {
      throw new NotFoundException("Aucun compte ScanLinkPay avec cet email — la personne doit d'abord créer un compte.");
    }

    if (targetUser.id === ownerId) {
      throw new BadRequestException('Vous ne pouvez pas vous inviter vous-même.');
    }

    const { data: currentRoles } = await this.supabaseService.getClient()
      .from('user_roles')
      .select('role:roles(slug)')
      .eq('user_id', targetUser.id);
    const slugs = (currentRoles || []).map((r: any) => r.role?.slug).filter(Boolean);
    if (slugs.some((slug: string) => slug !== 'client')) {
      throw new BadRequestException(
        "Cette personne a déjà un rôle sur ScanLinkPay (marchand, caissier, entreprise ou administrateur) — seul un compte client peut être invité comme caissier.",
      );
    }

    const { data: existingMembership } = await this.supabaseService.getClient()
      .from('merchant_users')
      .select('id')
      .eq('user_id', targetUser.id)
      .limit(1);
    if (existingMembership && existingMembership.length > 0) {
      throw new BadRequestException("Cette personne fait déjà partie de l'équipe d'une boutique.");
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

  /**
   * Removes one of THIS store's cashiers and returns them to a client
   * account. The role reset used to run whether or not the person was in
   * the team, so any merchant could demote any user — admins included — to
   * client by passing their id.
   */
  async removeMerchantUser(merchantId: string, ownerId: string, userId: string) {
    if (userId === ownerId) {
      throw new BadRequestException("Le propriétaire ne peut pas se retirer de sa propre boutique.");
    }

    const { data: cashierRole } = await this.supabaseService.getClient()
      .from('roles')
      .select('id')
      .eq('slug', 'cashier')
      .single();

    if (!cashierRole) {
      throw new NotFoundException('Role "cashier" not found');
    }

    const { data: removed, error } = await this.supabaseService.getClient()
      .from('merchant_users')
      .delete()
      .eq('merchant_id', merchantId)
      .eq('user_id', userId)
      .eq('role_id', cashierRole.id)
      .select('id');

    if (error) {
      throw new Error(`Failed to remove merchant user: ${error.message}`);
    }

    if (!removed || removed.length === 0) {
      throw new NotFoundException("Ce caissier ne fait pas partie de l'équipe de cette boutique.");
    }

    const { data: clientRole } = await this.supabaseService.getClient()
      .from('roles')
      .select('id')
      .eq('slug', 'client')
      .single();

    if (clientRole) {
      // Only touch the global role if it is still "cashier of this store".
      const { data: demoted } = await this.supabaseService.getClient()
        .from('user_roles')
        .delete()
        .eq('user_id', userId)
        .eq('role_id', cashierRole.id)
        .eq('merchant_id', merchantId)
        .select('id');

      if (demoted && demoted.length > 0) {
        await this.supabaseService.getClient().from('user_roles').insert({
          user_id: userId,
          role_id: clientRole.id,
        });
      }
    }

    return { success: true };
  }

  async getMerchantStats(merchantId: string) {
    return this.getStatsForMerchantIds([merchantId]);
  }

  /** Same shape as getMerchantStats(), summed across every id given — the
   * organization-level "aggregated across all my stores" stats reuse this
   * directly instead of a parallel query set. */
  async getStatsForMerchantIds(merchantIds: string[]) {
    if (!merchantIds.length) {
      return {
        total_transactions: 0,
        today_transactions: 0,
        volume: sumByCurrency(null, 'amount_cents'),
        net: sumByCurrency(null, 'net_cents'),
        pending: sumByCurrency(null, 'amount_cents'),
        pending_count: 0,
        failed_count: 0,
      };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { count: totalTransactions } = await this.supabaseService.getClient()
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .in('merchant_id', merchantIds);

    const { count: todayTransactions } = await this.supabaseService.getClient()
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .in('merchant_id', merchantIds)
      .gte('created_at', today.toISOString());

    const { data: volumeData } = await this.supabaseService.getClient()
      .from('transactions')
      .select('amount_cents, net_cents, currency')
      .in('merchant_id', merchantIds)
      .eq('status', 'SUCCESS');

    const { data: pendingData, count: pendingCount } = await this.supabaseService.getClient()
      .from('transactions')
      .select('amount_cents, currency', { count: 'exact' })
      .in('merchant_id', merchantIds)
      .in('status', ['PENDING', 'PROCESSING']);

    const { count: failedCount } = await this.supabaseService.getClient()
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .in('merchant_id', merchantIds)
      .eq('status', 'FAILED');

    return {
      total_transactions: totalTransactions || 0,
      today_transactions: todayTransactions || 0,
      // Independent per-currency figures — never summed together (a CDF
      // volume and a USD volume added as raw cents is a meaningless number).
      volume: sumByCurrency(volumeData, 'amount_cents'),
      net: sumByCurrency(volumeData, 'net_cents'),
      pending: sumByCurrency(pendingData, 'amount_cents'),
      pending_count: pendingCount || 0,
      failed_count: failedCount || 0,
    };
  }
}
