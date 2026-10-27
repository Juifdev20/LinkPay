import { Injectable, NotFoundException, BadRequestException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { AuthService } from '../auth/auth.service';
import { MerchantsService } from '../merchants/merchants.service';
import { NotificationsService } from '../notifications/notifications.service';
import { sumByCurrency } from '../common/utils/currency';
import { businessDayKey, startOfBusinessDay, lastBusinessDays } from '../common/utils/business-day';
import { trustedNow } from '../common/utils/trusted-clock';
import { requireStaffStation } from '../common/org-access';
import * as QRCode from 'qrcode';

/**
 * Columns of `organizations` that only the API itself may see: the stock
 * management password hash and its attempt/lock counters. Organization rows
 * are sent to the owner AND to the organization's staff (cashiers...), so a
 * hash left in them would let any staff member recover the stock password.
 */
/** organizations.sector — what the business sells, and so how (till or Ventes). */
const ORGANIZATION_SECTORS = ['supermarche', 'electronique'];

const ORGANIZATION_PRIVATE_FIELDS = [
  'stock_password_hash', 'stock_password_attempts', 'stock_password_locked_until',
  'treasury_password_hash', 'treasury_password_attempts', 'treasury_password_locked_until',
] as const;

/**
 * What a staff member (cashier, manager...) sees of their organization: enough
 * to run their screens and print receipts — never its payout account, legal
 * representative, identifiers or tax regime, which are the owner's.
 */
const ORGANIZATION_STAFF_FIELDS = [
  'id', 'name', 'legal_name', 'sector', 'currency', 'secondary_currencies', 'status', 'scanlinkpay_number',
  'scanlinkpay_qr_url', 'receipt_footer_message', 'logo_url', 'contact', 'onboarding_completed_at', 'created_at',
  'stock_password_required',
] as const;

export function toStaffOrganization<T extends Record<string, any>>(row: T): Partial<T> {
  const out: Record<string, any> = {};
  for (const field of ORGANIZATION_STAFF_FIELDS) if (field in row) out[field] = row[field];
  return out as Partial<T>;
}

export function toPublicOrganization<T extends Record<string, any>>(row: T): T {
  const publicRow: Record<string, any> = { ...row };
  for (const field of ORGANIZATION_PRIVATE_FIELDS) delete publicRow[field];
  return publicRow as T;
}

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    private supabaseService: SupabaseService,
    private authService: AuthService,
    private merchantsService: MerchantsService,
    private notificationsService: NotificationsService,
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

    return { organization: toPublicOrganization(org), access_token };
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

    return this.withOwnerPhone(data);
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

    return this.withOwnerPhone(await this.ensureScanLinkPayQr(data));
  }

  /** The business phone shown on invoices is the owner account's phone (the
   * number the owner registered with). Read from profiles, never stored twice. */
  private async withOwnerPhone(org: any) {
    const { data } = await this.supabaseService.getClient()
      .from('profiles')
      .select('phone')
      .eq('id', org.owner_id)
      .maybeSingle();
    return { ...toPublicOrganization(org), owner_phone: data?.phone ?? null };
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
      .maybeSingle();

    // A database failure must not look like "this number does not exist": the payer (or an integrator such as HotelSaver) would
    // blame the number. Only an empty answer is "introuvable".
    if (error) {
      this.logger.error(`Lookup of the ScanLinkPay number ${scanlinkpayNumber} (organizations) failed: ${error.message}`);
      throw new ServiceUnavailableException('Le service est momentanément indisponible. Réessayez dans un instant.');
    }
    if (!data) {
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
    await this.suggestSellingStation(orgId, ownerId, merchant);
    return { merchant };
  }

  /**
   * A supplier (migration 084/085) that opens a new station is asked whether it should also sell to enterprises — it
   * is never ticked on its own: the owner decides, in the supplier space. Best effort: never fails the creation.
   */
  private async suggestSellingStation(orgId: string, ownerId: string, merchant: { id: string; name?: string }) {
    try {
      const { data: profile } = await this.supabaseService.getClient()
        .from('supplier_profiles').select('organization_id').eq('organization_id', orgId).maybeSingle();
      if (!profile) return;
      await this.notificationsService.create({
        user_id: ownerId,
        type: 'supplier_network',
        title: `Nouvelle station « ${merchant.name || 'station'} »`,
        body: 'Voulez-vous qu’elle vende aussi aux entreprises ? Cochez-la dans votre espace fournisseur, puis remplissez son catalogue.',
        data: { url: '/dashboard/organization/supplier', merchant_id: merchant.id },
      });
    } catch {
      /* migration 084 not run, or notification down: the station is created anyway */
    }
  }

  /** Renames one of the organization's stations (owner only — checked by the controller). */
  async renameOrganizationMerchant(orgId: string, merchantId: string, name: string) {
    const trimmed = (name || '').trim();
    if (!trimmed) throw new BadRequestException('Donnez un nom à la station');
    const { data, error } = await this.supabaseService.getClient()
      .from('merchants')
      .update({ name: trimmed, updated_at: new Date().toISOString() })
      .eq('id', merchantId)
      .eq('organization_id', orgId)
      .select('id, name')
      .maybeSingle();
    if (error) throw new Error(`Failed to rename station: ${error.message}`);
    if (!data) throw new NotFoundException("Cette station n'appartient pas à votre entreprise");
    return data;
  }

  /** The station a staff member works in (refused when they have none — see common/org-access). */
  staffStation(userId: string, orgId: string): Promise<string> {
    return requireStaffStation(this.supabaseService.getClient(), userId, orgId);
  }

  /** The organization's stores (its stations), or just one of them when `stationId` is given. */
  async getOrganizationMerchants(orgId: string, stationId?: string) {
    let query = this.supabaseService.getClient()
      .from('merchants')
      .select('*')
      .eq('organization_id', orgId);
    if (stationId) query = query.eq('id', stationId);
    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch organization merchants: ${error.message}`);
    }
    return data || [];
  }

  async getOrganizationStats(orgId: string, stationId?: string) {
    const merchants = await this.getOrganizationMerchants(orgId, stationId);
    return this.merchantsService.getStatsForMerchantIds(merchants.map((m) => m.id));
  }

  /** Per-station figures for the owner's "Meilleures stations" widget, the
   * station chips and the Stations page: till sales today and over 7 days,
   * head count, plus the ScanLinkPay stats getMerchantStats() gives. */
  async getOrganizationStoresBreakdown(orgId: string, stationId?: string) {
    const merchants = await this.getOrganizationMerchants(orgId, stationId);
    const client = this.supabaseService.getClient();
    // "Today" is the business day (fixed timezone), the same cut as the home hero and chart.
    const now = trustedNow();
    const todayKey = businessDayKey(now);
    const weekStart = new Date(startOfBusinessDay(now).getTime() - 6 * 24 * 60 * 60 * 1000); // today and the 6 days before, like the home chart
    // A payment can't be later than now (older sales were stamped by a host clock that ran ahead): clamp, like the hero.
    const dayOf = (paidAt: string) => businessDayKey(new Date(Math.min(new Date(paidAt).getTime(), now.getTime())));

    const breakdown = await Promise.all(
      merchants.map(async (m) => {
        const [stats, { data: tickets }, { data: sales }, { count: staffCount }, { data: spent }] = await Promise.all([
          this.merchantsService.getMerchantStats(m.id),
          // The till's paid tickets (cash and ScanLinkPay) of the last 7 days — a cash sale never
          // becomes a wallet transaction, so `volume` alone would miss most of a station's takings.
          client.from('pos_tickets').select('total_cents, currency, paid_at').eq('merchant_id', m.id).eq('status', 'paid').gte('paid_at', weekStart.toISOString()),
          // The Ventes module's paid sales (businesses that sell without a till) count as station takings too.
          client.from('sales').select('total_cents, currency, paid_at').eq('merchant_id', m.id).eq('status', 'PAID').gte('paid_at', weekStart.toISOString()),
          client.from('organization_staff').select('id', { count: 'exact', head: true }).eq('merchant_id', m.id).is('deactivated_at', null),
          // The station's recorded expenses of the week (table missing before migration 019/083: no expenses).
          client.from('organization_expenses').select('amount_cents, currency, created_at, approved_at').eq('organization_id', orgId).eq('merchant_id', m.id).eq('status', 'approved').or(`created_at.gte.${weekStart.toISOString()},approved_at.gte.${weekStart.toISOString()}`),
        ]);
        const outgoings = spent || [];
        const todaysSpent = outgoings.filter((e: any) => (e.approved_at || e.created_at) && dayOf(e.approved_at || e.created_at) === todayKey);
        const takings = [...(tickets || []), ...(sales || [])];
        const todays = takings.filter((t) => t.paid_at && dayOf(t.paid_at) === todayKey);
        return {
          merchant_id: m.id,
          merchant_name: m.name,
          city: m.city ?? null,
          staff_count: staffCount || 0,
          today_pos_sales: sumByCurrency(todays, 'total_cents'),
          week_pos_sales: sumByCurrency(takings, 'total_cents'),
          today_expenses: sumByCurrency(todaysSpent, 'amount_cents'),
          week_expenses: sumByCurrency(outgoings, 'amount_cents'),
          ...stats,
        };
      }),
    );

    // Best station first: by till sales of the week — CDF, then USD (never added together).
    return breakdown.sort((a, b) => (b.week_pos_sales.CDF - a.week_pos_sales.CDF) || (b.week_pos_sales.USD - a.week_pos_sales.USD));
  }

  /** Latest transactions across every store this organization owns, for the
   * "Transactions récentes" dashboard widget. */
  async getOrganizationRecentTransactions(orgId: string, limit = 10, stationId?: string) {
    const merchants = await this.getOrganizationMerchants(orgId, stationId);
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

  /** Full, paginated sales history across every store this organization
   * owns, with an optional [from, to) date range — the "Transactions" tab
   * for an enterprise account (unlike getOrganizationRecentTransactions
   * above, which is just the last 10 for the dashboard widget). Only one
   * store exists per organization in practice (see validateOrganization's
   * auto-created default store), but this still fans out across every
   * merchant_id the org owns rather than assuming exactly one, same
   * reasoning as the rest of this service. */
  async getOrganizationTransactions(orgId: string, options: { from?: string; to?: string; page?: number; limit?: number; stationId?: string }) {
    const merchants = await this.getOrganizationMerchants(orgId, options.stationId);
    const merchantIds = merchants.map((m) => m.id);
    if (!merchantIds.length) return { items: [], total: 0 };

    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, options.limit || 20);

    let query = this.supabaseService.getClient()
      .from('transactions')
      .select('id, amount_cents, currency, status, created_at, merchant:merchants(name)', { count: 'exact' })
      .in('merchant_id', merchantIds)
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (options.from) query = query.gte('created_at', options.from);
    if (options.to) query = query.lt('created_at', options.to);

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`Failed to fetch organization transactions: ${error.message}`);
    }
    return { items: data || [], total: count || 0 };
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
    // Two sectors (migration 076): a food shop is a supermarket; an app not updated yet may still send 'alimentation'.
    if (updates.sector === 'alimentation') updates = { ...updates, sector: 'supermarche' };
    if (updates.sector && !ORGANIZATION_SECTORS.includes(updates.sector)) {
      throw new BadRequestException("Secteur inconnu : choisissez « Supermarché & alimentation » ou « Électronique ».");
    }

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

    return toPublicOrganization(data);
  }

  /** Owner submits their completed KYB onboarding for super-admin review —
   * first submission or a resubmission after rejection both go through
   * here, which is why it resets rejection_reason unconditionally. Does
   * NOT touch `status` beyond ensuring it's 'pending' — the org only
   * becomes 'active' (and gets its ScanLinkPay number) once a super admin
   * calls validateOrganization() below. */
  async submitOrganization(id: string) {
    const org = await this.getOrganizationById(id);
    if (!org.onboarding_completed_at) {
      throw new BadRequestException('Terminez la configuration de l\'entreprise avant de soumettre pour validation');
    }
    if (org.status !== 'pending' && org.status !== 'rejected') {
      throw new BadRequestException('Cette entreprise ne peut pas être soumise dans son état actuel');
    }

    const { data, error } = await this.supabaseService.getClient()
      .from('organizations')
      .update({ status: 'pending', submitted_at: new Date().toISOString(), rejection_reason: null })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to submit organization: ${error.message}`);
    }

    await this.notifyAllSuperAdmins(
      'org_submitted',
      'Nouvelle entreprise à valider',
      `${org.name} a soumis son dossier pour validation.`,
      { organization_id: id },
    );

    return toPublicOrganization(data);
  }

  /** Super admin approves the submission — this is the moment the
   * organization is treated as "really created": status flips to 'active'
   * and the BEFORE UPDATE trigger set up in migration 028 fills
   * scanlinkpay_number on this exact write (it was deliberately left NULL
   * until now). */
  async validateOrganization(id: string, adminId: string) {
    const org = await this.getOrganizationById(id);

    const { data, error } = await this.supabaseService.getClient()
      .from('organizations')
      .update({ status: 'active', validated_at: new Date().toISOString(), validated_by: adminId })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to validate organization: ${error.message}`);
    }

    // The organization gets its first store (station) — no separate "create a
    // boutique" step for the owner. Named "<org> — Principale" so it isn't
    // mistaken for the business itself; the owner can rename it.
    // Guarded on zero existing merchants so this never
    // duplicates a store on a re-validate call, and never touches orgs that
    // already created additional stores manually before this changed.
    const existingMerchants = await this.getOrganizationMerchants(id);
    if (existingMerchants.length === 0) {
      await this.createOrganizationMerchant(id, org.owner_id, '', {
        name: `${org.name} — Principale`,
        legal_name: org.legal_name,
        city: org.contact?.address?.city,
        address: [org.contact?.address?.avenue, org.contact?.address?.commune].filter(Boolean).join(', ') || undefined,
        default_currency: org.currency,
      });
    }

    await this.notificationsService.create({
      user_id: org.owner_id,
      type: 'org_validated',
      title: 'Entreprise validée',
      body: `${org.name} a été validée. Votre numéro ScanLinkPay est disponible.`,
      data: { organization_id: id },
    });

    return toPublicOrganization(data);
  }

  async rejectOrganization(id: string, reason: string) {
    const org = await this.getOrganizationById(id);

    const { data, error } = await this.supabaseService.getClient()
      .from('organizations')
      .update({ status: 'rejected', rejection_reason: reason })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to reject organization: ${error.message}`);
    }

    await this.notificationsService.create({
      user_id: org.owner_id,
      type: 'org_rejected',
      title: 'Entreprise rejetée',
      body: `${org.name} a été rejetée : ${reason}`,
      data: { organization_id: id, reason },
    });

    return toPublicOrganization(data);
  }

  /** No "notify every user with role X" helper exists anywhere in the
   * codebase yet (NotificationsService.create() is single-user only) — this
   * queries user_roles for every current super_admin and loops create(). */
  private async notifyAllSuperAdmins(type: string, title: string, body: string, data?: Record<string, any>) {
    const { data: superAdmins, error } = await this.supabaseService.getClient()
      .from('user_roles')
      .select('user_id, role:roles!inner(slug)')
      .eq('role.slug', 'super_admin');

    if (error) {
      this.logger.warn(`Failed to look up super admins for notification: ${error.message}`);
      return;
    }

    await Promise.all(
      (superAdmins || []).map((row: any) =>
        this.notificationsService.create({ user_id: row.user_id, type, title, body, data }),
      ),
    );
  }

  async createExpense(orgId: string, userId: string, data: { amount_cents: number; currency?: string; description?: string; merchant_id?: string }) {
    if (data.merchant_id) {
      const stations = await this.getOrganizationMerchants(orgId, data.merchant_id);
      if (!stations.length) throw new BadRequestException("Cette station n'appartient pas à votre entreprise");
    }
    const { data: expense, error } = await this.supabaseService.getClient()
      .from('organization_expenses')
      .insert({
        organization_id: orgId,
        amount_cents: data.amount_cents,
        currency: data.currency || 'CDF',
        description: data.description,
        merchant_id: data.merchant_id || null,
        created_by: userId,
        // The trusted clock, like sales: the day an expense falls on must not depend on this host's clock.
        created_at: trustedNow().toISOString(),
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
        .eq('organization_id', orgId)
        .eq('status', 'approved');

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

  /**
   * Expenses of the last `days` business days (the server cuts the days, like sales stats), for the
   * home chart's red curve: per day and currency, plus today's total. `stationId` narrows to one station.
   */
  async getExpensesStats(orgId: string, days = 7, stationId?: string) {
    const now = trustedNow();
    const windowDays = Math.min(Math.max(Math.floor(days) || 7, 1), 90);
    const dayKeys = lastBusinessDays(windowDays, now);
    const from = new Date(startOfBusinessDay(now).getTime() - (windowDays - 1) * 24 * 60 * 60 * 1000);
    const todayKey = businessDayKey(now);
    const byDay = new Map<string, { CDF: number; USD: number }>(dayKeys.map((k) => [k, { CDF: 0, USD: 0 }]));
    try {
      let query = this.supabaseService.getClient()
        .from('organization_expenses')
        .select('amount_cents, currency, created_at, approved_at')
        .eq('organization_id', orgId)
        .eq('status', 'approved')
        .or(`created_at.gte.${from.toISOString()},approved_at.gte.${from.toISOString()}`);
      if (stationId) query = query.eq('merchant_id', stationId);
      const { data, error } = await query;
      if (error) throw error;
      for (const e of data || []) {
        // An expense can't be dated after now: clamp, like sales.
        const day = businessDayKey(new Date(Math.min(new Date(e.approved_at || e.created_at).getTime(), now.getTime())));
        const slot = byDay.get(day);
        if (slot) slot[e.currency === 'USD' ? 'USD' : 'CDF'] += e.amount_cents || 0;
      }
    } catch (err: any) {
      this.logger.warn(`Expenses stats unavailable for org ${orgId} (migration 083 likely pending): ${err.message}`);
    }
    return {
      day_keys: dayKeys,
      today_key: todayKey,
      daily: dayKeys.map((day) => ({ day, ...byDay.get(day)! })),
      today: byDay.get(todayKey) ?? { CDF: 0, USD: 0 },
    };
  }
}
