import { BadRequestException, ForbiddenException, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { WalletsService } from '../wallets/wallets.service';
import { WalletPinService } from '../wallets/wallet-pin.service';
import { JobLockService } from '../common/job-lock/job-lock.service';

const DAY_MS = 86_400_000;
export const SUPPLIER_PLAN_CURRENCIES = ['CDF', 'USD'] as const;
export const MAX_SUPPLIER_PLAN_MONTHS = 12;

export interface SupplierPlanSettings {
  trial_days: number;
  /** The year costs (12 − annual_free_months) months. */
  annual_free_months: number;
  reminder_days: number[];
}
export const DEFAULT_SUPPLIER_PLAN_SETTINGS: SupplierPlanSettings = { trial_days: 30, annual_free_months: 2, reminder_days: [7, 3, 1] };

export type SupplierPlanStatus = 'trial' | 'active' | 'expired';

export interface SupplierPlanState {
  status: SupplierPlanStatus;
  /** trial or active: the supplier takes new orders and invitations. */
  can_sell: boolean;
  trial_ends_at: string;
  trial_days_left: number;
  plan_expires_at: string | null;
  plan_days_left: number | null;
}

/** What "Devenir fournisseur" shows before anything is paid: the trial and the prices set by the super admin. */
export interface SupplierPlanOffer {
  trial_days: number;
  annual_free_months: number;
  /** Price of one month per currency, in cents. */
  prices: Record<string, number>;
}

export interface SupplierPlanQuote {
  plan: 'monthly' | 'annual';
  months: number;
  months_charged: number;
  currency: string;
  price_month_cents: number;
  amount_cents: number;
}

const daysBetween = (later: number, earlier: number) => Math.ceil((later - earlier) / DAY_MS);

/**
 * The "Fournisseur" plan (DECISIONS.md 23/10, phase C): a business that sells to other businesses pays it. A free
 * trial (length set by the super admin, fixed when the owner becomes a supplier), then a monthly price, or a year for
 * (12 − N) months — prices and N set by the super admin. Paid by the owner from their wallet, with their PIN
 * (purchase_supplier_plan, migration 084). Paying while the plan runs adds the months after its end.
 */
@Injectable()
export class SupplierPlanService {
  private readonly logger = new Logger(SupplierPlanService.name);

  constructor(
    private supabaseService: SupabaseService,
    private notifications: NotificationsService,
    private audit: AuditService,
    private wallets: WalletsService,
    private pins: WalletPinService,
    @Optional() private jobLock?: JobLockService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  async getSettings(): Promise<SupplierPlanSettings> {
    const { data, error } = await this.db.from('supplier_plan_settings').select('*').eq('id', 1).maybeSingle();
    if (error || !data) return { ...DEFAULT_SUPPLIER_PLAN_SETTINGS };
    return {
      trial_days: data.trial_days,
      annual_free_months: data.annual_free_months,
      reminder_days: [...(data.reminder_days || [])].sort((a: number, b: number) => b - a),
    };
  }

  async getPrices(): Promise<Record<string, number>> {
    const { data } = await this.db.from('supplier_plan_prices').select('currency, price_month_cents');
    const prices: Record<string, number> = {};
    for (const p of data || []) prices[p.currency] = Number(p.price_month_cents);
    return prices;
  }

  async offer(): Promise<SupplierPlanOffer> {
    const [settings, prices] = await Promise.all([this.getSettings(), this.getPrices()]);
    return { trial_days: settings.trial_days, annual_free_months: settings.annual_free_months, prices };
  }

  /** The plan of a supplier profile (its trial_ends_at / plan_expires_at). */
  stateOf(profile: { trial_ends_at: string; plan_expires_at?: string | null }, now = Date.now()): SupplierPlanState {
    const trialEnd = new Date(profile.trial_ends_at).getTime();
    const expiry = profile.plan_expires_at ? new Date(profile.plan_expires_at).getTime() : undefined;
    const running = expiry !== undefined && expiry > now;
    const trial = now < trialEnd;
    const status: SupplierPlanStatus = running ? 'active' : trial ? 'trial' : 'expired';
    return {
      status,
      can_sell: running || trial,
      trial_ends_at: new Date(trialEnd).toISOString(),
      trial_days_left: Math.max(0, daysBetween(trialEnd, now)),
      plan_expires_at: expiry !== undefined ? new Date(expiry).toISOString() : null,
      plan_days_left: running ? Math.max(1, daysBetween(expiry!, now)) : null,
    };
  }

  /** Refuses what a supplier without a running plan may not take (new orders, new clients). */
  assertCanSell(profile: { trial_ends_at: string; plan_expires_at?: string | null; display_name?: string }) {
    if (!this.stateOf(profile).can_sell) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'SUPPLIER_PLAN_REQUIRED',
        message: `${profile.display_name || 'Ce fournisseur'} ne prend plus de nouvelles commandes pour le moment (abonnement Fournisseur à renouveler).`,
      });
    }
  }

  async quote(input: { plan: 'monthly' | 'annual'; months?: number; currency: string }): Promise<SupplierPlanQuote> {
    if (!(SUPPLIER_PLAN_CURRENCIES as readonly string[]).includes(input.currency)) throw new BadRequestException('Devise non prise en charge.');
    const [settings, prices] = await Promise.all([this.getSettings(), this.getPrices()]);
    const price = prices[input.currency];
    if (!price || price <= 0) throw new BadRequestException(`L'abonnement Fournisseur n'est pas encore en vente en ${input.currency}.`);
    let months: number;
    let charged: number;
    if (input.plan === 'annual') {
      months = 12;
      charged = 12 - Math.min(11, Math.max(0, settings.annual_free_months));
    } else if (input.plan === 'monthly') {
      months = Number(input.months ?? 1);
      if (!Number.isInteger(months) || months < 1 || months > MAX_SUPPLIER_PLAN_MONTHS) {
        throw new BadRequestException(`Le nombre de mois doit être compris entre 1 et ${MAX_SUPPLIER_PLAN_MONTHS}.`);
      }
      charged = months;
    } else {
      throw new BadRequestException('Formule inconnue.');
    }
    return { plan: input.plan, months, months_charged: charged, currency: input.currency, price_month_cents: price, amount_cents: price * charged };
  }

  /** The owner pays the plan from their wallet. The amount is always computed here, never taken from the request. */
  async subscribe(
    userId: string,
    orgId: string,
    input: { plan: 'monthly' | 'annual'; months?: number; currency: string; pin: string },
    idempotencyKey: string,
  ) {
    if (!idempotencyKey) throw new BadRequestException('Idempotency-Key header is required');
    const { data: org } = await this.db.from('organizations').select('id, owner_id').eq('id', orgId).maybeSingle();
    if (!org || org.owner_id !== userId) throw new ForbiddenException("Seul le patron de l'entreprise paie l'abonnement Fournisseur.");
    const quote = await this.quote(input);
    await this.pins.verifyPin(userId, input.pin);
    const wallet = await this.wallets.getWalletByUserId(userId);
    if (wallet.status !== 'ACTIVE') throw new BadRequestException(`Votre portefeuille est ${wallet.status}, paiement impossible.`);

    const { data, error } = await this.db.rpc('purchase_supplier_plan', {
      p_org: orgId,
      p_user: userId,
      p_wallet: wallet.id,
      p_plan: quote.plan,
      p_months: quote.months,
      p_months_charged: quote.months_charged,
      p_currency: quote.currency,
      p_amount: quote.amount_cents,
      p_reference: `supplier:${orgId}:${idempotencyKey}`.slice(0, 200),
    });
    if (error) {
      if (/Insufficient balance/i.test(error.message)) {
        throw new BadRequestException('Solde insuffisant dans votre portefeuille ScanLinkPay. Rechargez-le puis réessayez.');
      }
      if (/SUPPLIER_PLAN_NOT_SUPPLIER/.test(error.message)) throw new BadRequestException("Devenez d'abord fournisseur.");
      this.logger.error(`purchase_supplier_plan failed: ${error.message}`);
      throw new BadRequestException("Le paiement n'a pas pu être effectué. Aucun montant n'a été débité.");
    }
    const row = Array.isArray(data) ? data[0] : data;
    try {
      await this.audit.log({
        user_id: userId, action: 'supplier_plan_paid', entity_type: 'organization', entity_id: orgId,
        changes: { plan: quote.plan, months: quote.months, amount_cents: quote.amount_cents, currency: quote.currency },
      });
      await this.notifications.create({
        user_id: userId,
        type: 'supplier_plan',
        title: 'Abonnement Fournisseur activé',
        body: `${quote.months} mois${quote.plan === 'annual' ? ` (dont ${quote.months - quote.months_charged} offert${quote.months - quote.months_charged > 1 ? 's' : ''})` : ''}. Montant débité : ${(quote.amount_cents / 100).toLocaleString('fr-FR')} ${quote.currency}.`,
        data: { organization_id: orgId, url: '/dashboard/organization/supplier' },
      });
    } catch (err) {
      this.logger.warn(`Supplier plan paid for ${orgId} but the journal/notification failed: ${(err as Error).message}`);
    }
    return { quote, plan_expires_at: row?.expires_at ?? null };
  }

  // ------------------------------------------------------------------ reminders

  /** Once a day: the owner is told when the trial or the plan is about to end (the admin's days), and when it has. */
  @Cron('10 8 * * *')
  async runDailyReminders(): Promise<number> {
    if (this.jobLock && !(await this.jobLock.acquire('supplier-plan-reminders', 3600))) return 0;
    return this.sendReminders();
  }

  async sendReminders(now = Date.now()): Promise<number> {
    const settings = await this.getSettings();
    const { data: profiles, error } = await this.db
      .from('supplier_profiles')
      .select('organization_id, trial_ends_at, plan_expires_at, trial_last_reminder_days, plan_last_reminder_days, active, organization:organizations(owner_id)')
      .eq('active', true);
    if (error) return 0;
    const due = (left: number, last: number | null | undefined) => {
      const hits = settings.reminder_days.filter((t) => left <= t && (last === null || last === undefined || t < last));
      return hits.length ? Math.min(...hits) : null;
    };
    let sent = 0;
    for (const p of profiles || []) {
      const ownerId = (p as any).organization?.owner_id;
      if (!ownerId) continue;
      const expiry = p.plan_expires_at ? new Date(p.plan_expires_at).getTime() : undefined;
      const paid = expiry !== undefined;
      const end = paid ? expiry! : new Date(p.trial_ends_at).getTime();
      const last = paid ? p.plan_last_reminder_days : p.trial_last_reminder_days;
      let threshold: number | null = null;
      if (end <= now) {
        if (now - end < 30 * DAY_MS && last !== 0) threshold = 0;
      } else {
        threshold = due(daysBetween(end, now), last);
      }
      if (threshold === null) continue;
      const what = paid ? 'Abonnement Fournisseur' : 'Essai gratuit Fournisseur';
      await this.notifications.create({
        user_id: ownerId,
        type: 'supplier_plan',
        title: threshold === 0 ? `${what} terminé` : `${what} : ${threshold} jour${threshold > 1 ? 's' : ''} restant${threshold > 1 ? 's' : ''}`,
        body: threshold === 0
          ? 'Vos clients ne peuvent plus vous passer de nouvelles commandes. Abonnez-vous pour les reprendre (les commandes en cours continuent).'
          : 'Abonnez-vous depuis votre portefeuille ScanLinkPay pour continuer à recevoir des commandes sans interruption.',
        data: { organization_id: p.organization_id, url: '/dashboard/organization/supplier' },
      }).catch(() => undefined);
      await this.db.from('supplier_profiles')
        .update(paid ? { plan_last_reminder_days: threshold } : { trial_last_reminder_days: threshold })
        .eq('organization_id', p.organization_id);
      sent++;
    }
    return sent;
  }

  // ------------------------------------------------------------------ super admin

  async adminOverview() {
    const [settings, prices] = await Promise.all([this.getSettings(), this.getPrices()]);
    const { data: revenue } = await this.db.rpc('supplier_plan_revenue');
    const { data: purchases } = await this.db
      .from('supplier_plan_purchases')
      .select('id, organization_id, plan, months, months_charged, currency, amount_cents, expires_at, created_at, organization:organizations(name)')
      .order('created_at', { ascending: false })
      .limit(50);
    const { data: profiles } = await this.db.from('supplier_profiles').select('trial_ends_at, plan_expires_at').eq('active', true);
    const states = (profiles || []).map((p: any) => this.stateOf(p).status);
    return {
      settings, prices, currencies: SUPPLIER_PLAN_CURRENCIES,
      revenue: revenue || [], recent_purchases: purchases || [],
      suppliers: { total: states.length, trial: states.filter((s) => s === 'trial').length, active: states.filter((s) => s === 'active').length, expired: states.filter((s) => s === 'expired').length },
    };
  }

  async updateSettings(adminId: string, dto: Partial<SupplierPlanSettings>) {
    const before = await this.getSettings();
    const patch: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString(), updated_by: adminId };
    if (dto.trial_days !== undefined) patch.trial_days = dto.trial_days;
    if (dto.annual_free_months !== undefined) patch.annual_free_months = dto.annual_free_months;
    if (dto.reminder_days !== undefined) patch.reminder_days = Array.from(new Set(dto.reminder_days)).sort((a, b) => b - a);
    const { error } = await this.db.from('supplier_plan_settings').upsert(patch);
    if (error) throw new Error(`Failed to save supplier plan settings: ${error.message}`);
    return { before, after: await this.getSettings() };
  }

  async updatePrices(prices: Record<string, number | null>) {
    const before = await this.getPrices();
    for (const [currency, value] of Object.entries(prices)) {
      if (!(SUPPLIER_PLAN_CURRENCIES as readonly string[]).includes(currency)) throw new BadRequestException(`Devise inconnue : ${currency}`);
      if (value === null) await this.db.from('supplier_plan_prices').delete().eq('currency', currency);
      else await this.db.from('supplier_plan_prices').upsert({ currency, price_month_cents: value });
    }
    return { before, after: await this.getPrices() };
  }
}
