import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { AuthService } from '../auth/auth.service';
import { MerchantsService } from '../merchants/merchants.service';

@Injectable()
export class OrganizationsService {
  constructor(
    private supabaseService: SupabaseService,
    private authService: AuthService,
    private merchantsService: MerchantsService,
  ) {}

  async createOrganization(ownerId: string, email: string, data: {
    name: string;
    legal_name?: string;
    contact?: Record<string, any>;
  }) {
    const { data: org, error } = await this.supabaseService.getClient()
      .from('organizations')
      .insert({
        ...data,
        owner_id: ownerId,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create organization: ${error.message}`);
    }

    const { data: role } = await this.supabaseService.getClient()
      .from('roles')
      .select('id')
      .eq('slug', 'enterprise')
      .single();

    if (role) {
      // The JWT model only supports one "current" role per user — replace
      // any prior row(s) instead of accumulating (same reasoning as
      // merchants.service.ts createMerchant()).
      await this.supabaseService.getClient().from('user_roles').delete().eq('user_id', ownerId);
      await this.supabaseService.getClient().from('user_roles').insert({
        user_id: ownerId,
        role_id: role.id,
        organization_id: org.id,
      });
    }

    const access_token = await this.authService.generateToken(ownerId, email, 'enterprise', undefined);

    return { organization: org, access_token };
  }

  async getOrganizationById(id: string) {
    const { data, error } = await this.supabaseService.getClient()
      .from('organizations')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException('Organization not found');
    }

    return data;
  }

  async getOrganizationByOwner(ownerId: string) {
    const { data, error } = await this.supabaseService.getClient()
      .from('organizations')
      .select('*')
      .eq('owner_id', ownerId)
      .single();

    if (error || !data) {
      throw new NotFoundException('No organization account found');
    }

    return data;
  }

  /** Creates a new store under this organization — same shape/validation as
   * a normal merchant self-signup (MerchantsService.createMerchant), just
   * with elevateCallerRole: false so the enterprise owner's canonical role
   * stays 'enterprise' (they can own many stores; only a merchant_users
   * row is added for each, not a role change). */
  async createOrganizationMerchant(orgId: string, ownerId: string, email: string, data: {
    name: string;
    legal_name?: string;
    phone?: string;
    email?: string;
    address?: string;
    city?: string;
    default_currency?: string;
  }) {
    const { merchant } = await this.merchantsService.createMerchant(ownerId, email, data, {
      organizationId: orgId,
      elevateCallerRole: false,
    });
    return { merchant };
  }

  async getOrganizationMerchants(orgId: string) {
    const { data, error } = await this.supabaseService.getClient()
      .from('merchants')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch organization merchants: ${error.message}`);
    }
    return data || [];
  }

  async getOrganizationStats(orgId: string) {
    const merchants = await this.getOrganizationMerchants(orgId);
    return this.merchantsService.getStatsForMerchantIds(merchants.map((m) => m.id));
  }

  /** Mints a merchant-scoped token pair for one of this organization's
   * stores — the owner's canonical role/user_roles row is never touched;
   * see JwtPayload.acting_as_org_id and AuthService.refresh() for how this
   * "temporary lens" survives token refresh without collapsing back to
   * 'enterprise'. */
  async enterOrganizationMerchant(orgId: string, ownerId: string, email: string, merchantId: string, sessionId?: string) {
    const { data: merchant, error } = await this.supabaseService.getClient()
      .from('merchants')
      .select('*')
      .eq('id', merchantId)
      .single();

    if (error || !merchant) {
      throw new NotFoundException('Store not found');
    }
    if (merchant.organization_id !== orgId) {
      throw new BadRequestException('This store does not belong to your organization');
    }

    const access_token = await this.authService.generateToken(ownerId, email, 'merchant', merchant.id, sessionId, orgId);
    const refresh_token = await this.authService.generateRefreshToken(ownerId, email, sessionId, merchant.id, orgId);

    return { merchant, access_token, refresh_token, organization_id: orgId };
  }

  async updateOrganization(id: string, updates: Record<string, any>) {
    const allowedFields = [
      'name',
      'legal_name',
      'contact',
      'status',
      'legal_form',
      'legal_identifiers',
      'sector',
      'description',
      'currency',
      'secondary_currencies',
      'tax_regime',
      'payout_info',
      'legal_representative',
      'receipt_footer_message',
      'onboarding_completed_at',
    ];
    const filtered: Record<string, any> = {};

    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        filtered[key] = updates[key];
      }
    }

    const { data, error } = await this.supabaseService.getClient()
      .from('organizations')
      .update(filtered)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update organization: ${error.message}`);
    }

    return data;
  }
}
