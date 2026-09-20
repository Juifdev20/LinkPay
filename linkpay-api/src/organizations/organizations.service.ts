import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { AuthService } from '../auth/auth.service';
import { MerchantsService } from '../merchants/merchants.service';
import { sumByCurrency } from '../common/utils/currency';
import * as QRCode from 'qrcode';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    private supabaseService: SupabaseService,
    private authService: AuthService,
    private merchantsService: MerchantsService,
    private configService: ConfigService,
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

    return this.ensureScanLinkPayQr(data);
  }

  /** Public lookup for the "pay by ScanLinkPay number" flow — anyone with
   * the number (scanned QR or typed manually) can look up which business
   * it belongs to and which of its stores can receive the payment, no auth
   * required (mirrors payment-requests' getByLinkToken/getByReference). */
  async getOrganizationByScanLinkPayNumber(scanlinkpayNumber: string) {
    const { data, error } = await this.supabaseService.getClient()
      .from('organizations')
      .select('id, name, legal_name, scanlinkpay_number')
      .eq('scanlinkpay_number', scanlinkpayNumber)
      .single();

    if (error || !data) {
      throw new NotFoundException('Numéro ScanLinkPay introuvable');
    }

    const merchants = await this.getOrganizationMerchants(data.id);
    return {
      ...data,
      merchants: merchants.map((m) => ({ id: m.id, name: m.name, logo_url: m.logo_url })),
    };
  }

  /** Lazily generates and persists the organization's fixed payment QR (same
   * qrcode + Storage bucket approach as payment-requests.service.ts's
   * per-invoice QR) the first time it's needed, instead of doing it at
   * organization-creation time — keeps createOrganization()/register()
   * free of Storage calls that could fail and block signup. */
  private async ensureScanLinkPayQr(org: any) {
    if (org.scanlinkpay_qr_url || !org.scanlinkpay_number) return org;

    try {
      const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:5173');
      const payUrl = `${frontendUrl}/pay/${org.scanlinkpay_number}`;
      const qrBuffer = await QRCode.toBuffer(payUrl, {
        width: 400,
        margin: 2,
        color: { dark: '#0F172A', light: '#FFFFFF' },
      });

      const fileName = `org-${org.id}.png`;
      const { error: uploadError } = await this.supabaseService.getClient()
        .storage
        .from('qr-codes')
        .upload(fileName, qrBuffer, { contentType: 'image/png', upsert: true });

      if (uploadError) {
        this.logger.warn(`Failed to upload ScanLinkPay QR for org ${org.id}: ${uploadError.message}`);
        return org;
      }

      const { data: urlData } = this.supabaseService.getClient().storage.from('qr-codes').getPublicUrl(fileName);
      const { data: updated } = await this.supabaseService.getClient()
        .from('organizations')
        .update({ scanlinkpay_qr_url: urlData.publicUrl })
        .eq('id', org.id)
        .select()
        .single();

      return updated || { ...org, scanlinkpay_qr_url: urlData.publicUrl };
    } catch (err: any) {
      this.logger.warn(`ScanLinkPay QR generation failed for org ${org.id}: ${err.message}`);
      return org;
    }
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

  /** Per-store stats for the "Meilleures boutiques" dashboard widget — same
   * getMerchantStats() the individual merchant dashboard already uses, just
   * called once per store instead of once aggregated across all of them. */
  async getOrganizationStoresBreakdown(orgId: string) {
    const merchants = await this.getOrganizationMerchants(orgId);

    const breakdown = await Promise.all(
      merchants.map(async (m) => ({
        merchant_id: m.id,
        merchant_name: m.name,
        ...(await this.merchantsService.getMerchantStats(m.id)),
      })),
    );

    return breakdown.sort((a, b) => (b.volume.CDF + b.volume.USD) - (a.volume.CDF + a.volume.USD));
  }

  /** Latest transactions across every store this organization owns, for the
   * "Transactions récentes" dashboard widget. */
  async getOrganizationRecentTransactions(orgId: string, limit = 10) {
    const merchants = await this.getOrganizationMerchants(orgId);
    const merchantIds = merchants.map((m) => m.id);
    if (!merchantIds.length) return [];

    const { data, error } = await this.supabaseService.getClient()
      .from('transactions')
      .select('id, amount_cents, currency, status, created_at, merchant:merchants(name)')
      .in('merchant_id', merchantIds)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to fetch organization transactions: ${error.message}`);
    }
    return data || [];
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

  async createExpense(orgId: string, userId: string, data: { amount_cents: number; currency?: string; description?: string }) {
    const { data: expense, error } = await this.supabaseService.getClient()
      .from('organization_expenses')
      .insert({
        organization_id: orgId,
        amount_cents: data.amount_cents,
        currency: data.currency || 'CDF',
        description: data.description,
        created_by: userId,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to record expense: ${error.message}`);
    }
    return expense;
  }

  /** Sums recorded expenses by currency for the dashboard's "Dépenses" tile.
   * Tolerates `organization_expenses` not existing yet (migration 017 not
   * run) by returning zero instead of throwing — same reasoning as
   * ensureScanLinkPayQr() tolerating a missing column, so the dashboard
   * never breaks while migrations are pending. */
  async getExpensesSummary(orgId: string) {
    try {
      const { data, error } = await this.supabaseService.getClient()
        .from('organization_expenses')
        .select('amount_cents, currency')
        .eq('organization_id', orgId);

      if (error) throw error;
      return sumByCurrency(data, 'amount_cents');
    } catch (err: any) {
      this.logger.warn(`Expenses summary unavailable for org ${orgId} (migration 017 likely pending): ${err.message}`);
      return sumByCurrency(null, 'amount_cents');
    }
  }

  async getExpenses(orgId: string, limit = 20) {
    try {
      const { data, error } = await this.supabaseService.getClient()
        .from('organization_expenses')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (err: any) {
      this.logger.warn(`Expenses list unavailable for org ${orgId} (migration 017 likely pending): ${err.message}`);
      return [];
    }
  }
}
