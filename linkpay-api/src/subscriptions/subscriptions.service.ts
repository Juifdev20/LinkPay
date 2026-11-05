import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { WalletsService } from '../wallets/wallets.service';
import { WalletPinService } from '../wallets/wallet-pin.service';
import {
  DEFAULT_SUBSCRIPTION_SETTINGS, MAX_SUBSCRIPTION_MONTHS, SUBSCRIPTION_CURRENCIES, SubscriptionMode, SubscriptionSettings,
} from './subscription';
import { JobLockService } from '../common/job-lock/job-lock.service';

const DAY_MS = 86_400_000;
const CACHE_TTL_MS = 15_000;
/** Hard cap of the in-memory caches: ids come from request URLs, so they must not be able to grow without limit. */
const CACHE_MAX_ENTRIES = 5_000;
const PAGE_SIZE = 1_000; // PostgREST returns at most 1000 rows per request

function remember<V>(map: Map<string, V>, key: string, value: V) {
  if (!map.has(key) && map.size >= CACHE_MAX_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

export type SubscriptionStatus = 'active' | 'trial' | 'expired' | 'none';

export interface SubscriptionState {
  organization_id: string;
  /** active: paid and running · trial: free trial · expired: was paid, ended · none: trial over, never paid */
  status: SubscriptionStatus;
  /** What happens to the business tools when status is expired / none. */
  mode: SubscriptionMode;
  expires_at: string | null;
  days_left: number | null;
  trial: { ends_at: string; active: boolean; days_left: number };
  settings: Pick<SubscriptionSettings, 'trial_end_mode' | 'expiry_mode'>;
  /** Price of one month per currency, in cents. */
  prices: Record<string, number>;
}

export interface Quote {
  months: number;
  currency: string;
  price_month_cents: number;
  amount_cents: number;
}

const daysBetween = (later: number, earlier: number) => Math.ceil((later - earlier) / DAY_MS);

/**
 * Monthly subscription of a business (organization): everything included, paid
 * from its owner's ScanLinkPay wallet. Prices, trial length, what happens when
 * it ends and the reminder days all come from the database (super admin screen).
 *
 *  - a new business uses EVERYTHING during the trial (trial_days from validation);
 *  - afterwards the business tools need a running subscription; without one the
 *    business is put in the mode the admin chose (read_only or blocked);
 *  - paying while the subscription runs ADDS the months after its end; paying
 *    after it ended restarts from now, so access resumes at once.
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);
  private readonly cache = new Map<string, { at: number; state: SubscriptionState }>();
  private readonly merchantOrg = new Map<string, { at: number; orgId: string | null }>();

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

  // ------------------------------------------------------------------ settings & prices

  private toSettings(data: any): SubscriptionSettings {
    if (!data) return { ...DEFAULT_SUBSCRIPTION_SETTINGS };
    return {
      trial_days: data.trial_days,
      trial_end_mode: data.trial_end_mode,
      expiry_mode: data.expiry_mode,
      reminder_days: [...(data.reminder_days || [])].sort((a: number, b: number) => b - a),
      billing_starts_at: data.billing_starts_at ?? null,
    };
  }

  async getSettings(): Promise<SubscriptionSettings> {
    const { data, error } = await this.db.from('subscription_settings').select('*').eq('id', 1).maybeSingle();
    if (error) this.logger.warn(`subscription_settings unreadable (migration 052 applied?): ${error.message}`);
    return this.toSettings(error ? null : data);
  }

  async getPrices(): Promise<Record<string, number>> {
    const { data } = await this.db.from('subscription_prices').select('currency, price_month_cents');
    const prices: Record<string, number> = {};
    (data || []).forEach((p: any) => { prices[p.currency] = Number(p.price_month_cents); });
    return prices;
  }

  // ------------------------------------------------------------------ state of one business

  private async loadOrg(orgId: string) {
    const { data, error } = await this.db
      .from('organizations')
      .select('id, owner_id, name, validated_at, created_at')
      .eq('id', orgId)
      .maybeSingle();
    if (error || !data) throw new NotFoundException('Entreprise introuvable');
    return data;
  }

  /** The business a store belongs to (null for a plain merchant: the subscription doesn't apply to it). */
  async organizationOfMerchant(merchantId: string): Promise<string | null> {
    const hit = this.merchantOrg.get(merchantId);
    if (hit && Date.now() - hit.at < 60_000) return hit.orgId;
    const { data } = await this.db.from('merchants').select('organization_id').eq('id', merchantId).maybeSingle();
    const orgId = data?.organization_id || null;
    remember(this.merchantOrg, merchantId, { at: Date.now(), orgId });
    return orgId;
  }

  /** Admins, the owner of the business, and staff of that business. The owner is checked in the database: their token may predate the business. */
  async assertMember(orgId: string, userId: string, callerOrgId: string | undefined, role: string) {
    if (role === 'admin' || role === 'super_admin') return;
    if (callerOrgId === orgId) return;
    const org = await this.loadOrg(orgId);
    if (org.owner_id !== userId) throw new ForbiddenException('Accès refusé à cette entreprise');
  }

  invalidate(orgId: string) {
    this.cache.delete(orgId);
  }

  /** The state of one business from its data (shared by getState and the super admin list). */
  private stateOf(
    orgId: string,
    org: { validated_at?: string | null; created_at: string },
    settings: SubscriptionSettings,
    prices: Record<string, number>,
    expiresAt: string | null,
    now: number,
  ): SubscriptionState {
    // The trial starts when the business was validated, but never before billing started (see billing_starts_at).
    const trialStart = Math.max(
      new Date(org.validated_at || org.created_at).getTime(),
      settings.billing_starts_at ? new Date(settings.billing_starts_at).getTime() : 0,
    );
    const trialEnd = trialStart + settings.trial_days * DAY_MS;
    const trialActive = now < trialEnd;
    const expiry = expiresAt ? new Date(expiresAt).getTime() : undefined;
    const running = expiry !== undefined && expiry > now;
    const status: SubscriptionStatus = running ? 'active' : trialActive ? 'trial' : expiry !== undefined ? 'expired' : 'none';

    return {
      organization_id: orgId,
      status,
      mode: status === 'expired' ? settings.expiry_mode : settings.trial_end_mode,
      expires_at: expiry !== undefined ? new Date(expiry).toISOString() : null,
      days_left: running ? Math.max(1, daysBetween(expiry!, now)) : null,
      trial: { ends_at: new Date(trialEnd).toISOString(), active: trialActive, days_left: Math.max(0, daysBetween(trialEnd, now)) },
      settings: { trial_end_mode: settings.trial_end_mode, expiry_mode: settings.expiry_mode },
      prices,
    };
  }

  async getState(orgId: string, now = Date.now()): Promise<SubscriptionState> {
    const hit = this.cache.get(orgId);
    if (hit && now - hit.at < CACHE_TTL_MS) return hit.state;

    const [org, settingsRes, prices, subRes] = await Promise.all([
      this.loadOrg(orgId),
      this.db.from('subscription_settings').select('*').eq('id', 1).maybeSingle(),
      this.getPrices(),
      this.db.from('organization_subscriptions').select('expires_at').eq('organization_id', orgId).maybeSingle(),
    ]);
    // Unreadable tables (migration 052 not applied yet, an outage) must NOT read as "no subscription":
    // that would cut every existing business off. Throwing lets assertAccess let the request through.
    if (settingsRes.error) throw new Error(`subscription_settings unreadable: ${settingsRes.error.message}`);
    if (subRes.error) throw new Error(`organization_subscriptions unreadable: ${subRes.error.message}`);
    const state = this.stateOf(orgId, org, this.toSettings(settingsRes.data), prices, subRes.data?.expires_at ?? null, now);
    remember(this.cache, orgId, { at: now, state });
    return state;
  }

  /**
   * Can this business use its tools right now? Throws the 403 the app turns
   * into "you have no active subscription — subscribe".
   * `write` is false for reading (GET): in read_only mode those still go through.
   */
  async assertAccess(orgId: string, write: boolean): Promise<void> {
    let state: SubscriptionState;
    try {
      state = await this.getState(orgId);
    } catch (err) {
      // An unknown business is not "unreadable tables": there is nothing to let through.
      if (err instanceof NotFoundException) throw err;
      // Never take a business offline because the subscription tables are unreachable or unmigrated.
      this.logger.warn(`Subscription check skipped (${(err as Error).message})`);
      return;
    }
    if (state.status === 'active' || state.status === 'trial') return;
    if (state.mode === 'read_only' && !write) return;

    const reason = state.status === 'expired' ? 'expired' : 'none';
    throw new ForbiddenException({
      statusCode: 403,
      code: 'SUBSCRIPTION_REQUIRED',
      reason,
      mode: state.mode,
      message:
        reason === 'expired'
          ? 'Votre abonnement a expiré. Renouvelez-le pour continuer à utiliser cette fonctionnalité.'
          : "Vous n'avez pas d'abonnement actif pour utiliser cette fonctionnalité. Abonnez-vous pour continuer.",
    });
  }

  // ------------------------------------------------------------------ price & purchase

  async quote(input: { months: number; currency: string }): Promise<Quote> {
    const { months, currency } = input;
    if (!Number.isInteger(months) || months < 1 || months > MAX_SUBSCRIPTION_MONTHS) {
      throw new BadRequestException(`Le nombre de mois doit être compris entre 1 et ${MAX_SUBSCRIPTION_MONTHS}.`);
    }
    if (!(SUBSCRIPTION_CURRENCIES as readonly string[]).includes(currency)) throw new BadRequestException('Devise non prise en charge.');
    const price = (await this.getPrices())[currency];
    if (!price || price <= 0) throw new BadRequestException(`L'abonnement n'est pas encore en vente en ${currency}.`);
    return { months, currency, price_month_cents: price, amount_cents: price * months };
  }

  async subscribe(
    userId: string,
    orgId: string,
    input: { months: number; currency: string; pin: string },
    idempotencyKey: string,
    caller: { role?: string; organizationId?: string } = {},
  ) {
    const org = await this.loadOrg(orgId);
    // The owner, or a station manager of this business (also re-checked in purchase_subscription).
    const isManager = caller.role === 'gerant' && caller.organizationId === orgId;
    if (org.owner_id !== userId && !isManager) {
      throw new ForbiddenException("Seul le patron de l'entreprise ou un gérant peut souscrire l'abonnement.");
    }
    if (!idempotencyKey) throw new BadRequestException('Idempotency-Key header is required');

    // The amount is always computed here from the admin's price, never taken from the request.
    const quote = await this.quote(input);
    await this.pins.verifyPin(userId, input.pin);

    const wallet = await this.wallets.getWalletByUserId(userId);
    if (wallet.status !== 'ACTIVE') throw new BadRequestException(`Votre portefeuille est ${wallet.status}, paiement impossible.`);

    const { data, error } = await this.db.rpc('purchase_subscription', {
      p_org: orgId,
      p_user: userId,
      p_wallet: wallet.id,
      p_months: quote.months,
      p_currency: quote.currency,
      p_amount: quote.amount_cents,
      p_reference: `sub:${orgId}:${idempotencyKey}`.slice(0, 200),
    });
    if (error) {
      if (/Insufficient balance/i.test(error.message)) {
        throw new BadRequestException('Solde insuffisant dans votre portefeuille ScanLinkPay. Rechargez-le puis réessayez.');
      }
      this.logger.error(`purchase_subscription failed: ${error.message}`);
      throw new BadRequestException("Le paiement n'a pas pu être effectué. Aucun montant n'a été débité.");
    }
    this.invalidate(orgId);

    const row = Array.isArray(data) ? data[0] : data;
    // The money has moved and the subscription is extended: a failing journal or notification must not report an error.
    try {
      await this.audit.log({
        user_id: userId,
        action: 'subscription_paid',
        entity_type: 'organization',
        entity_id: orgId,
        changes: { months: quote.months, amount_cents: quote.amount_cents, currency: quote.currency },
      });
      await this.notifications.create({
        user_id: userId,
        type: 'subscription',
        title: 'Abonnement activé',
        body: `${quote.months} mois ajouté${quote.months > 1 ? 's' : ''}. Montant débité : ${(quote.amount_cents / 100).toLocaleString('fr-FR')} ${quote.currency}.`,
        data: { organization_id: orgId, months: quote.months, expires_at: row?.expires_at },
      });
    } catch (err) {
      this.logger.warn(`Subscription paid for ${orgId} but the journal/notification failed: ${(err as Error).message}`);
    }
    return { quote, expires_at: row?.expires_at ?? null, state: await this.getState(orgId) };
  }

  // ------------------------------------------------------------------ reminders

  /** Every row of a query, page by page (the database answers at most PAGE_SIZE rows at a time). */
  private async fetchAll(page: (from: number, to: number) => PromiseLike<{ data: any[] | null }>): Promise<any[]> {
    const rows: any[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data } = await page(from, from + PAGE_SIZE - 1);
      rows.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) return rows;
    }
  }

  /**
   * Once a day: tell each patron when the free trial or the subscription is
   * about to end, and when it has. Each threshold (7, 3, 1 days… the admin's
   * list) is announced once per period; paying re-arms them.
   */
  @Cron('0 8 * * *')
  async runDailyReminders(): Promise<number> {
    // Once a day, on one API instance (migration 053): otherwise every instance would notify every patron.
    if (this.jobLock && !(await this.jobLock.acquire('subscription-reminders', 3600))) return 0;
    return this.sendReminders();
  }

  async sendReminders(now = Date.now()): Promise<number> {
    const settings = await this.getSettings();
    const thresholds = settings.reminder_days;
    let sent = 0;

    const orgs = await this.fetchAll((from, to) =>
      this.db.from('organizations').select('id, owner_id, validated_at, created_at').not('owner_id', 'is', null).order('id').range(from, to));
    const subs = await this.fetchAll((from, to) =>
      this.db.from('organization_subscriptions').select('organization_id, expires_at, last_reminder_days, trial_last_reminder_days').order('organization_id').range(from, to));
    const subOf = new Map(subs.map((s: any) => [s.organization_id, s]));
    const billingFloor = settings.billing_starts_at ? new Date(settings.billing_starts_at).getTime() : 0;

    const dueThreshold = (left: number, last: number | null | undefined) => {
      const due = thresholds.filter((t) => left <= t && (last === null || last === undefined || t < last));
      return due.length ? Math.min(...due) : null;
    };

    for (const org of orgs) {
      const sub: any = subOf.get(org.id);
      const expiry = sub?.expires_at ? new Date(sub.expires_at).getTime() : undefined;

      if (expiry !== undefined) {
        // --- subscription
        let threshold: number | null = null;
        if (expiry <= now) {
          if (now - expiry < 30 * DAY_MS && sub.last_reminder_days !== 0) threshold = 0;
        } else {
          threshold = dueThreshold(daysBetween(expiry, now), sub.last_reminder_days);
        }
        if (threshold !== null) {
          await this.notifications.create({
            user_id: org.owner_id,
            type: 'subscription',
            title: threshold === 0 ? 'Abonnement expiré' : `Abonnement : ${threshold} jour${threshold > 1 ? 's' : ''} restant${threshold > 1 ? 's' : ''}`,
            body: threshold === 0
              ? 'Votre abonnement a expiré. Ajoutez des mois pour reprendre immédiatement.'
              : 'Votre abonnement expire bientôt. Ajoutez des mois pour ne pas être interrompu.',
            data: { organization_id: org.id, days_left: threshold },
          });
          await this.db.from('organization_subscriptions').update({ last_reminder_days: threshold }).eq('organization_id', org.id);
          sent++;
        }
        if (expiry > now) continue; // paying customers don't get trial notices
      }

      // --- trial (only for businesses that are not subscribed)
      const end = Math.max(new Date(org.validated_at || org.created_at).getTime(), billingFloor) + settings.trial_days * DAY_MS;
      const last = sub?.trial_last_reminder_days as number | null | undefined;
      let threshold: number | null = null;
      if (end <= now) {
        if (now - end < 30 * DAY_MS && last !== 0) threshold = 0;
      } else {
        threshold = dueThreshold(daysBetween(end, now), last);
      }
      if (threshold === null) continue;
      await this.notifications.create({
        user_id: org.owner_id,
        type: 'subscription',
        title: threshold === 0 ? "Fin de l'essai gratuit" : `Essai gratuit : ${threshold} jour${threshold > 1 ? 's' : ''} restant${threshold > 1 ? 's' : ''}`,
        body: threshold === 0
          ? "Votre essai gratuit est terminé. Abonnez-vous pour continuer à utiliser la caisse, le stock et le reste."
          : "Abonnez-vous dès maintenant depuis votre portefeuille ScanLinkPay pour ne pas être interrompu.",
        data: { organization_id: org.id, trial: true, days_left: threshold },
      });
      await this.db.from('organization_subscriptions').upsert({ organization_id: org.id, trial_last_reminder_days: threshold });
      sent++;
    }
    return sent;
  }

  // ------------------------------------------------------------------ super admin

  async adminOverview() {
    const [settings, prices] = await Promise.all([this.getSettings(), this.getPrices()]);
    const { data: revenue } = await this.db.rpc('subscription_revenue');
    const { data: purchases } = await this.db
      .from('subscription_purchases')
      .select('id, organization_id, months, currency, amount_cents, expires_at, created_at, organization:organizations(name)')
      .order('created_at', { ascending: false })
      .limit(50);
    const { count: activeCount } = await this.db
      .from('organization_subscriptions')
      .select('organization_id', { count: 'exact', head: true })
      .gt('expires_at', new Date().toISOString());
    return {
      settings, prices, currencies: SUBSCRIPTION_CURRENCIES,
      revenue: revenue || [], recent_purchases: purchases || [], active_subscriptions: activeCount ?? 0,
    };
  }

  async updateSettings(adminId: string, dto: Partial<SubscriptionSettings>) {
    const patch: Record<string, any> = { updated_at: new Date().toISOString(), updated_by: adminId };
    if (dto.trial_days !== undefined) patch.trial_days = dto.trial_days;
    if (dto.trial_end_mode !== undefined) patch.trial_end_mode = dto.trial_end_mode;
    if (dto.expiry_mode !== undefined) patch.expiry_mode = dto.expiry_mode;
    if (dto.reminder_days !== undefined) patch.reminder_days = Array.from(new Set(dto.reminder_days)).sort((a, b) => b - a);
    const before = await this.getSettings();
    const { error } = await this.db.from('subscription_settings').upsert({ id: 1, ...patch });
    if (error) throw new Error(`Failed to save subscription settings: ${error.message}`);
    this.cache.clear();
    return { before, after: await this.getSettings() };
  }

  /** Price of one month per currency, in cents (null removes the price: not on sale in that currency). */
  async updatePrices(prices: Record<string, number | null>) {
    const before = await this.getPrices();
    for (const [currency, value] of Object.entries(prices)) {
      if (!(SUBSCRIPTION_CURRENCIES as readonly string[]).includes(currency)) throw new BadRequestException(`Devise inconnue : ${currency}`);
      if (value === null) await this.db.from('subscription_prices').delete().eq('currency', currency);
      else await this.db.from('subscription_prices').upsert({ currency, price_month_cents: value });
    }
    this.cache.clear();
    return { before, after: await this.getPrices() };
  }

  // ------------------------------------------------------------------ super admin : activer / désactiver à la main

  /** Businesses with their subscription state, to find one and activate or deactivate it. */
  async adminOrganizations(q: { search?: string; limit?: number; offset?: number }, now = Date.now()) {
    const limit = Math.min(Math.max(Math.trunc(q.limit ?? 30), 1), 100);
    const offset = Math.max(Math.trunc(q.offset ?? 0), 0);
    let query = this.db
      .from('organizations')
      .select('id, name, owner_id, validated_at, created_at', { count: 'exact' })
      .order('name')
      .range(offset, offset + limit - 1);
    const search = (q.search ?? '').trim().slice(0, 80);
    if (search) query = query.ilike('name', `%${search.replace(/[%_\\]/g, '\\$&')}%`);
    const { data: orgs, count, error } = await query;
    if (error) throw new BadRequestException(error.message);
    const list = (orgs ?? []) as any[];
    const ids = list.map((o) => o.id);
    const ownerIds = [...new Set(list.map((o) => o.owner_id).filter(Boolean))];
    const nowIso = new Date(now).toISOString();

    const [settings, prices, subs, paid, owners] = await Promise.all([
      this.getSettings(),
      this.getPrices(),
      ids.length ? this.db.from('organization_subscriptions').select('organization_id, expires_at').in('organization_id', ids) : { data: [] as any[] },
      ids.length ? this.db.from('subscription_purchases').select('organization_id, expires_at').in('organization_id', ids).gt('expires_at', nowIso) : { data: [] as any[] },
      ownerIds.length ? this.db.from('profiles').select('id, full_name').in('id', ownerIds) : { data: [] as any[] },
    ]);
    const expiresOf = new Map<string, string | null>(((subs as any).data ?? []).map((r: any) => [r.organization_id, r.expires_at as string | null]));
    const paidUntil = new Map<string, string>();
    for (const r of ((paid as any).data ?? []) as any[]) {
      if (!paidUntil.has(r.organization_id) || r.expires_at > paidUntil.get(r.organization_id)!) paidUntil.set(r.organization_id, r.expires_at);
    }
    const ownerName = new Map<string, string | null>(((owners as any).data ?? []).map((o: any) => [o.id, o.full_name as string | null]));

    return {
      total: count ?? list.length,
      organizations: list.map((o) => {
        const st = this.stateOf(o.id, o, settings, prices, expiresOf.get(o.id) ?? null, now);
        return {
          id: o.id,
          name: o.name,
          owner_name: ownerName.get(o.owner_id) ?? null,
          status: st.status,
          expires_at: st.expires_at,
          days_left: st.days_left,
          trial_ends_at: st.trial.ends_at,
          trial_active: st.trial.active,
          /** The latest end of a subscription the business PAID for, if it still runs. */
          paid_until: paidUntil.get(o.id) ?? null,
        };
      }),
    };
  }

  /** One business: its state, the manual activations / deactivations and its payments. */
  async adminOrganizationDetail(orgId: string) {
    await this.loadOrg(orgId);
    const [state, grants, purchases] = await Promise.all([
      this.getState(orgId),
      this.db.from('subscription_grants').select('id, action, amount, unit, previous_expires_at, new_expires_at, reason, created_at, granted_by').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(20),
      this.db.from('subscription_purchases').select('id, months, currency, amount_cents, starts_at, expires_at, created_at').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(10),
    ]);
    return { state, grants: grants.data ?? [], purchases: purchases.data ?? [] };
  }

  private rpcError(error: { message?: string }): Error {
    const m = error.message ?? '';
    if (m.includes('GRANT_ORG_NOT_FOUND')) return new NotFoundException('Entreprise introuvable');
    if (m.includes('GRANT_INVALID_AMOUNT')) return new BadRequestException('Durée invalide : 1 à 730 jours, ou 1 à 24 mois.');
    if (m.includes('GRANT_INVALID_UNIT')) return new BadRequestException("L'unité doit être « jours » ou « mois ».");
    if (m.includes('REVOKE_NOTHING_TO_REVOKE')) return new BadRequestException("Cette entreprise n'a pas d'abonnement en cours à désactiver.");
    return new BadRequestException(m || 'Opération impossible');
  }

  private dateFr(iso: string) {
    return new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Africa/Kinshasa', day: 'numeric', month: 'long', year: 'numeric' });
  }

  /** Gives N days (or months) of subscription without payment: adds to the current end, or restarts from now. */
  async grant(adminId: string, orgId: string, dto: { amount: number; unit: 'days' | 'months'; reason?: string }) {
    const org = await this.loadOrg(orgId);
    const before = await this.getState(orgId).catch(() => null);
    const { data, error } = await this.db.rpc('grant_subscription', {
      p_org: orgId, p_admin: adminId, p_amount: dto.amount, p_unit: dto.unit, p_reason: (dto.reason ?? '').trim().slice(0, 200),
    });
    if (error) throw this.rpcError(error);
    this.invalidate(orgId);
    const expiresAt: string | undefined = (Array.isArray(data) ? data[0] : data)?.new_expires_at;
    if (expiresAt && org.owner_id) {
      await this.notifications
        .create({
          user_id: org.owner_id,
          type: 'subscription',
          title: 'Abonnement activé',
          body: `Votre abonnement est actif jusqu'au ${this.dateFr(expiresAt)}.`,
          data: { organization_id: orgId, expires_at: expiresAt },
        })
        .catch((e: Error) => this.logger.warn(`Notification d'activation non envoyée : ${e.message}`));
    }
    return { organization_id: orgId, name: org.name, expires_at: expiresAt ?? null, before: before?.status ?? null, state: await this.getState(orgId) };
  }

  /**
   * Ends the running subscription now; the business can then subscribe normally. A subscription the business PAID for
   * is only ended on explicit confirmation (it loses what it paid).
   */
  async revoke(adminId: string, orgId: string, dto: { reason?: string; confirm_paid?: boolean }) {
    const org = await this.loadOrg(orgId);
    const { data: paid } = await this.db.from('subscription_purchases').select('id').eq('organization_id', orgId).gt('expires_at', new Date().toISOString()).limit(1);
    if ((paid?.length ?? 0) > 0 && !dto.confirm_paid) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'ABONNEMENT_PAYE',
        message: "Cette entreprise a payé un abonnement qui court encore : le désactiver lui fait perdre ce qu'elle a payé. Confirmez pour continuer.",
      });
    }
    const { data, error } = await this.db.rpc('revoke_subscription', { p_org: orgId, p_admin: adminId, p_reason: (dto.reason ?? '').trim().slice(0, 200) });
    if (error) throw this.rpcError(error);
    this.invalidate(orgId);
    const row = Array.isArray(data) ? data[0] : data;
    if (org.owner_id) {
      await this.notifications
        .create({
          user_id: org.owner_id,
          type: 'subscription',
          title: 'Abonnement désactivé',
          body: 'Votre abonnement a été désactivé. Vous pouvez en acheter un depuis votre espace pour reprendre.',
          data: { organization_id: orgId },
        })
        .catch((e: Error) => this.logger.warn(`Notification de désactivation non envoyée : ${e.message}`));
    }
    return { organization_id: orgId, name: org.name, previous_expires_at: row?.previous_expires_at ?? null, state: await this.getState(orgId) };
  }
}
