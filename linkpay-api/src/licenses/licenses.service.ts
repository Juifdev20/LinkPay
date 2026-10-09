import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { WalletsService } from '../wallets/wallets.service';
import { WalletPinService } from '../wallets/wallet-pin.service';
import {
  DEFAULT_LICENSE_SETTINGS, LICENSE_CURRENCIES, LicenseMode, LicenseSettings, MAX_LICENSE_DAYS,
} from './license-features';

const DAY_MS = 86_400_000;
const CACHE_TTL_MS = 15_000;

export type FeatureStatus = 'active' | 'trial' | 'expired' | 'none';

export interface FeatureState {
  key: string;
  name: string;
  description: string | null;
  status: FeatureStatus;
  expires_at: string | null;
  days_left: number | null;
  /** What happens to this feature when it is not usable: the screens stay readable, or they are closed. */
  mode: LicenseMode;
  prices: Record<string, number>;
}

export interface LicenseState {
  organization_id: string;
  trial: { ends_at: string; active: boolean; days_left: number };
  settings: Pick<LicenseSettings, 'trial_end_mode' | 'expiry_mode'>;
  features: FeatureState[];
  bundle_prices: Record<string, number>;
}

export interface Quote {
  features: string[];
  days: number;
  currency: string;
  is_bundle: boolean;
  per_day_cents: number;
  amount_cents: number;
  lines: { key: string; name: string; per_day_cents: number }[];
}

const daysBetween = (later: number, earlier: number) => Math.ceil((later - earlier) / DAY_MS);

/**
 * Licences: a business (organization) buys the features it uses, by the day,
 * paid from its owner's ScanLinkPay wallet. Everything the super admin sets —
 * prices, trial length, what happens when it ends — lives in the database and
 * is read here; nothing is hardcoded.
 *
 * Rules:
 *  - a new business can use EVERYTHING during the trial (trial_days from the
 *    day it was validated);
 *  - after that, a feature needs a running licence; without one the business is
 *    put in the mode the admin chose: read_only (can look, can't change) or blocked;
 *  - buying days while a licence is still running ADDS them after its end.
 */
@Injectable()
export class LicensesService {
  private readonly logger = new Logger(LicensesService.name);
  private readonly cache = new Map<string, { at: number; state: LicenseState }>();
  private readonly merchantOrg = new Map<string, { at: number; orgId: string | null }>();

  constructor(
    private supabaseService: SupabaseService,
    private notifications: NotificationsService,
    private audit: AuditService,
    private wallets: WalletsService,
    private pins: WalletPinService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  // ------------------------------------------------------------------ settings & catalogue

  async getSettings(): Promise<LicenseSettings> {
    const { data, error } = await this.db.from('license_settings').select('*').eq('id', 1).maybeSingle();
    if (error || !data) {
      if (error) this.logger.warn(`license_settings unreadable (migration 052 applied?): ${error.message}`);
      return { ...DEFAULT_LICENSE_SETTINGS };
    }
    return {
      trial_days: data.trial_days,
      trial_end_mode: data.trial_end_mode,
      expiry_mode: data.expiry_mode,
      reminder_days: [...(data.reminder_days || [])].sort((a: number, b: number) => b - a),
    };
  }

  private async loadFeatures(includeInactive = false) {
    let q = this.db.from('license_features').select('key, name, description, sort_order, is_active').order('sort_order');
    if (!includeInactive) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw new Error(`Failed to read licence features: ${error.message}`);
    const { data: prices } = await this.db.from('license_feature_prices').select('feature_key, currency, price_per_day_cents');
    const byFeature: Record<string, Record<string, number>> = {};
    (prices || []).forEach((p: any) => {
      (byFeature[p.feature_key] ||= {})[p.currency] = Number(p.price_per_day_cents);
    });
    const { data: bundle } = await this.db.from('license_bundle_prices').select('currency, price_per_day_cents');
    const bundlePrices: Record<string, number> = {};
    (bundle || []).forEach((b: any) => { bundlePrices[b.currency] = Number(b.price_per_day_cents); });
    return {
      features: (data || []).map((f: any) => ({ ...f, prices: byFeature[f.key] || {} })),
      bundlePrices,
    };
  }

  /** What anyone can see before buying: the features, their prices per day, the all-in price. */
  async getCatalog() {
    const [settings, { features, bundlePrices }] = await Promise.all([this.getSettings(), this.loadFeatures()]);
    return {
      trial_days: settings.trial_days,
      features: features.map((f: any) => ({ key: f.key, name: f.name, description: f.description, prices: f.prices })),
      bundle_prices: bundlePrices,
      currencies: LICENSE_CURRENCIES,
    };
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

  /** The business a store belongs to (null for a plain merchant: licences don't apply to it). */
  async organizationOfMerchant(merchantId: string): Promise<string | null> {
    const hit = this.merchantOrg.get(merchantId);
    if (hit && Date.now() - hit.at < 60_000) return hit.orgId;
    const { data } = await this.db.from('merchants').select('organization_id').eq('id', merchantId).maybeSingle();
    const orgId = data?.organization_id || null;
    this.merchantOrg.set(merchantId, { at: Date.now(), orgId });
    return orgId;
  }

  invalidate(orgId: string) {
    this.cache.delete(orgId);
  }

  async getState(orgId: string, now = Date.now()): Promise<LicenseState> {
    const hit = this.cache.get(orgId);
    if (hit && now - hit.at < CACHE_TTL_MS) return hit.state;

    const [org, settings, { features, bundlePrices }, licenses] = await Promise.all([
      this.loadOrg(orgId),
      this.getSettings(),
      this.loadFeatures(),
      this.db.from('organization_licenses').select('feature_key, expires_at').eq('organization_id', orgId),
    ]);

    const trialStart = new Date(org.validated_at || org.created_at).getTime();
    const trialEnd = trialStart + settings.trial_days * DAY_MS;
    const trialActive = now < trialEnd;
    const expiryByFeature: Record<string, number> = {};
    ((licenses as any).data || []).forEach((l: any) => { expiryByFeature[l.feature_key] = new Date(l.expires_at).getTime(); });

    const state: LicenseState = {
      organization_id: orgId,
      trial: { ends_at: new Date(trialEnd).toISOString(), active: trialActive, days_left: Math.max(0, daysBetween(trialEnd, now)) },
      settings: { trial_end_mode: settings.trial_end_mode, expiry_mode: settings.expiry_mode },
      bundle_prices: bundlePrices,
      features: features.map((f: any) => {
        const expiry = expiryByFeature[f.key];
        const running = expiry !== undefined && expiry > now;
        const status: FeatureStatus = running ? 'active' : trialActive ? 'trial' : expiry !== undefined ? 'expired' : 'none';
        return {
          key: f.key,
          name: f.name,
          description: f.description,
          status,
          expires_at: expiry !== undefined ? new Date(expiry).toISOString() : null,
          days_left: running ? Math.max(1, daysBetween(expiry, now)) : null,
          mode: status === 'expired' ? settings.expiry_mode : settings.trial_end_mode,
          prices: f.prices,
        };
      }),
    };
    this.cache.set(orgId, { at: now, state });
    return state;
  }

  /**
   * Can this business use the feature right now? Throws the 403 the app turns
   * into "you have no licence for this — buy one".
   * `write` is false for reading (GET): in read_only mode those still go through.
   */
  async assertAccess(orgId: string, featureKey: string, write: boolean): Promise<void> {
    let state: LicenseState;
    try {
      state = await this.getState(orgId);
    } catch (err) {
      // Never take a business offline because the licence tables are unreachable or unmigrated.
      this.logger.warn(`Licence check skipped (${(err as Error).message})`);
      return;
    }
    const feature = state.features.find((f) => f.key === featureKey);
    if (!feature) return; // a feature the admin switched off is not sold, so nothing to protect
    if (feature.status === 'active' || feature.status === 'trial') return;
    if (feature.mode === 'read_only' && !write) return;

    const reason = feature.status === 'expired' ? 'expired' : 'none';
    throw new ForbiddenException({
      statusCode: 403,
      code: 'LICENSE_REQUIRED',
      feature: feature.key,
      feature_name: feature.name,
      reason,
      mode: feature.mode,
      message:
        reason === 'expired'
          ? `Votre licence « ${feature.name} » a expiré. Ajoutez des jours pour continuer.`
          : `Vous n'avez pas de licence pour la fonctionnalité « ${feature.name} ». Achetez-la pour l'utiliser.`,
    });
  }

  // ------------------------------------------------------------------ price & purchase

  async quote(input: { features?: string[]; all?: boolean; days: number; currency: string }): Promise<Quote> {
    const { days, currency } = input;
    if (!Number.isInteger(days) || days < 1 || days > MAX_LICENSE_DAYS) {
      throw new BadRequestException(`Le nombre de jours doit être compris entre 1 et ${MAX_LICENSE_DAYS}.`);
    }
    if (!(LICENSE_CURRENCIES as readonly string[]).includes(currency)) throw new BadRequestException('Devise non prise en charge.');

    const { features, bundlePrices } = await this.loadFeatures();
    const sellable = features.filter((f: any) => f.prices[currency] !== undefined);
    const chosen = input.all
      ? sellable
      : features.filter((f: any) => (input.features || []).includes(f.key));
    if (chosen.length === 0) throw new BadRequestException('Choisissez au moins une fonctionnalité.');
    for (const f of chosen) {
      if (f.prices[currency] === undefined) {
        throw new BadRequestException(`« ${f.name} » n'est pas encore en vente en ${currency}.`);
      }
    }
    const unknown = (input.features || []).filter((k) => !features.some((f: any) => f.key === k));
    if (!input.all && unknown.length) throw new BadRequestException(`Fonctionnalité inconnue : ${unknown[0]}`);

    const sum = chosen.reduce((n: number, f: any) => n + f.prices[currency], 0);
    // "Everything" can have its own (cheaper) price per day; otherwise it is the sum.
    const isBundle = !!input.all && chosen.length === features.length && bundlePrices[currency] !== undefined;
    const perDay = isBundle ? bundlePrices[currency] : sum;
    if (perDay <= 0) throw new BadRequestException("Ces fonctionnalités n'ont pas encore de prix.");

    return {
      features: chosen.map((f: any) => f.key),
      days,
      currency,
      is_bundle: isBundle,
      per_day_cents: perDay,
      amount_cents: perDay * days,
      lines: chosen.map((f: any) => ({ key: f.key, name: f.name, per_day_cents: f.prices[currency] })),
    };
  }

  async purchase(
    userId: string,
    orgId: string,
    input: { features?: string[]; all?: boolean; days: number; currency: string; pin: string },
    idempotencyKey: string,
  ) {
    const org = await this.loadOrg(orgId);
    if (org.owner_id !== userId) throw new ForbiddenException("Seul le patron de l'entreprise peut acheter une licence.");
    if (!idempotencyKey) throw new BadRequestException('Idempotency-Key header is required');

    const quote = await this.quote(input);
    await this.pins.verifyPin(userId, input.pin);

    const wallet = await this.wallets.getWalletByUserId(userId);
    if (wallet.status !== 'ACTIVE') throw new BadRequestException(`Votre portefeuille est ${wallet.status}, achat impossible.`);

    const { data, error } = await this.db.rpc('purchase_license', {
      p_org: orgId,
      p_user: userId,
      p_wallet: wallet.id,
      p_features: quote.features,
      p_days: quote.days,
      p_currency: quote.currency,
      p_amount: quote.amount_cents,
      p_bundle: quote.is_bundle,
      p_reference: `lic:${orgId}:${idempotencyKey}`.slice(0, 200),
    });
    if (error) {
      if (/Insufficient balance/i.test(error.message)) {
        throw new BadRequestException('Solde insuffisant dans votre portefeuille ScanLinkPay. Rechargez-le puis réessayez.');
      }
      this.logger.error(`purchase_license failed: ${error.message}`);
      throw new BadRequestException("L'achat n'a pas pu être effectué. Aucun montant n'a été débité.");
    }
    this.invalidate(orgId);

    const names = quote.lines.map((l) => l.name).join(', ');
    await this.audit.log({
      user_id: userId,
      action: 'license_purchased',
      entity_type: 'organization',
      entity_id: orgId,
      changes: { features: quote.features, days: quote.days, amount_cents: quote.amount_cents, currency: quote.currency, bundle: quote.is_bundle },
    });
    await this.notifications.create({
      user_id: userId,
      type: 'license',
      title: 'Licence activée',
      body: `${quote.days} jour${quote.days > 1 ? 's' : ''} ajouté${quote.days > 1 ? 's' : ''} : ${names}. Montant débité : ${(quote.amount_cents / 100).toLocaleString('fr-FR')} ${quote.currency}.`,
      data: { organization_id: orgId, features: quote.features },
    });
    return { quote, expires: data, state: await this.getState(orgId) };
  }

  // ------------------------------------------------------------------ reminders

  /**
   * Once a day: tell each patron which licences (or the trial) are about to
   * end, and when they have. Each threshold (7, 3, 1 days… the admin's list) is
   * announced once per period; adding days re-arms them.
   */
  @Cron('0 8 * * *')
  async sendReminders(now = Date.now()): Promise<number> {
    const settings = await this.getSettings();
    const thresholds = settings.reminder_days;
    let sent = 0;

    // --- licences
    const horizon = new Date(now + (Math.max(0, ...thresholds) + 1) * DAY_MS).toISOString();
    const { data: rows } = await this.db
      .from('organization_licenses')
      .select('organization_id, feature_key, expires_at, last_reminder_days')
      .lte('expires_at', horizon);
    const { data: features } = await this.db.from('license_features').select('key, name');
    const nameOf = (k: string) => (features || []).find((f: any) => f.key === k)?.name || k;

    type Batch = { threshold: number; expired: boolean; names: string[]; keys: string[] };
    const perOrg = new Map<string, Batch[]>();
    for (const r of rows || []) {
      const expiry = new Date(r.expires_at).getTime();
      const left = daysBetween(expiry, now);
      let threshold: number | null = null;
      let expired = false;
      if (expiry <= now) {
        if (r.last_reminder_days !== 0) { threshold = 0; expired = true; }
      } else {
        const due = thresholds.filter((t) => left <= t && (r.last_reminder_days === null || r.last_reminder_days === undefined || t < r.last_reminder_days));
        if (due.length) threshold = Math.min(...due);
      }
      if (threshold === null) continue;
      const batches = perOrg.get(r.organization_id) || [];
      let b = batches.find((x) => x.threshold === threshold);
      if (!b) { b = { threshold, expired, names: [], keys: [] }; batches.push(b); }
      b.names.push(nameOf(r.feature_key));
      b.keys.push(r.feature_key);
      perOrg.set(r.organization_id, batches);
    }

    for (const [orgId, batches] of perOrg) {
      const org = await this.loadOrg(orgId).catch(() => null);
      if (!org) continue;
      for (const b of batches) {
        await this.notifications.create({
          user_id: org.owner_id,
          type: 'license',
          title: b.expired ? 'Licence expirée' : `Licence : ${b.threshold} jour${b.threshold > 1 ? 's' : ''} restant${b.threshold > 1 ? 's' : ''}`,
          body: b.expired
            ? `${b.names.join(', ')} : expirée. Ajoutez des jours pour reprendre immédiatement.`
            : `${b.names.join(', ')} : expire bientôt. Ajoutez des jours pour ne pas être interrompu.`,
          data: { organization_id: orgId, features: b.keys, days_left: b.threshold },
        });
        await this.db.from('organization_licenses')
          .update({ last_reminder_days: b.threshold })
          .eq('organization_id', orgId)
          .in('feature_key', b.keys);
        sent++;
      }
    }

    // --- trial
    const { data: orgs } = await this.db.from('organizations').select('id, owner_id, validated_at, created_at').not('owner_id', 'is', null);
    const { data: states } = await this.db.from('organization_license_state').select('organization_id, trial_last_reminder_days');
    const lastTrial = new Map((states || []).map((s: any) => [s.organization_id, s.trial_last_reminder_days]));
    for (const org of orgs || []) {
      const end = new Date(org.validated_at || org.created_at).getTime() + settings.trial_days * DAY_MS;
      const left = daysBetween(end, now);
      const last = lastTrial.get(org.id) as number | null | undefined;
      let threshold: number | null = null;
      if (end <= now) {
        if (now - end < 30 * DAY_MS && last !== 0) threshold = 0;
      } else {
        const due = thresholds.filter((t) => left <= t && (last === null || last === undefined || t < last));
        if (due.length) threshold = Math.min(...due);
      }
      if (threshold === null) continue;
      await this.notifications.create({
        user_id: org.owner_id,
        type: 'license',
        title: threshold === 0 ? "Fin de l'essai gratuit" : `Essai gratuit : ${threshold} jour${threshold > 1 ? 's' : ''} restant${threshold > 1 ? 's' : ''}`,
        body: threshold === 0
          ? "Votre essai gratuit est terminé. Achetez une licence pour continuer à utiliser vos fonctionnalités."
          : 'Choisissez dès maintenant les fonctionnalités et le nombre de jours : le paiement se fait depuis votre portefeuille ScanLinkPay.',
        data: { organization_id: org.id, trial: true, days_left: threshold },
      });
      await this.db.from('organization_license_state').upsert({ organization_id: org.id, trial_last_reminder_days: threshold });
      sent++;
    }
    return sent;
  }

  // ------------------------------------------------------------------ super admin

  async adminOverview() {
    const [settings, { features, bundlePrices }] = await Promise.all([this.getSettings(), this.loadFeatures(true)]);
    const { data: revenue } = await this.db.rpc('license_revenue');
    const { data: purchases } = await this.db
      .from('license_purchases')
      .select('id, organization_id, features, is_bundle, days, currency, amount_cents, created_at, organization:organizations(name)')
      .order('created_at', { ascending: false })
      .limit(50);
    return { settings, features, bundle_prices: bundlePrices, currencies: LICENSE_CURRENCIES, revenue: revenue || [], recent_purchases: purchases || [] };
  }

  async updateSettings(adminId: string, dto: Partial<LicenseSettings>) {
    const patch: Record<string, any> = { updated_at: new Date().toISOString(), updated_by: adminId };
    if (dto.trial_days !== undefined) patch.trial_days = dto.trial_days;
    if (dto.trial_end_mode !== undefined) patch.trial_end_mode = dto.trial_end_mode;
    if (dto.expiry_mode !== undefined) patch.expiry_mode = dto.expiry_mode;
    if (dto.reminder_days !== undefined) patch.reminder_days = Array.from(new Set(dto.reminder_days)).sort((a, b) => b - a);
    const before = await this.getSettings();
    const { error } = await this.db.from('license_settings').upsert({ id: 1, ...patch });
    if (error) throw new Error(`Failed to save licence settings: ${error.message}`);
    this.cache.clear();
    return { before, after: await this.getSettings() };
  }

  /** Name / description / on-sale switch / prices per day (null removes a price). */
  async updateFeature(key: string, dto: { name?: string; description?: string; is_active?: boolean; prices?: Record<string, number | null> }) {
    const { data: current } = await this.db.from('license_features').select('key').eq('key', key).maybeSingle();
    if (!current) throw new NotFoundException('Fonctionnalité inconnue');
    const patch: Record<string, any> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.is_active !== undefined) patch.is_active = dto.is_active;
    if (Object.keys(patch).length) {
      const { error } = await this.db.from('license_features').update(patch).eq('key', key);
      if (error) throw new Error(`Failed to update feature: ${error.message}`);
    }
    for (const [currency, value] of Object.entries(dto.prices || {})) {
      if (!(LICENSE_CURRENCIES as readonly string[]).includes(currency)) throw new BadRequestException(`Devise inconnue : ${currency}`);
      if (value === null) await this.db.from('license_feature_prices').delete().eq('feature_key', key).eq('currency', currency);
      else await this.db.from('license_feature_prices').upsert({ feature_key: key, currency, price_per_day_cents: value });
    }
    this.cache.clear();
    return (await this.loadFeatures(true)).features.find((f: any) => f.key === key);
  }

  async updateBundle(prices: Record<string, number | null>) {
    for (const [currency, value] of Object.entries(prices)) {
      if (!(LICENSE_CURRENCIES as readonly string[]).includes(currency)) throw new BadRequestException(`Devise inconnue : ${currency}`);
      if (value === null) await this.db.from('license_bundle_prices').delete().eq('currency', currency);
      else await this.db.from('license_bundle_prices').upsert({ currency, price_per_day_cents: value });
    }
    this.cache.clear();
    return (await this.loadFeatures(true)).bundlePrices;
  }
}
