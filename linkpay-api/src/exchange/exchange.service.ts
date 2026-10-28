import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SecurityAlertsService } from '../security/security-alerts.service';
import { WalletsService } from '../wallets/wallets.service';
import { WalletPinService } from '../wallets/wallet-pin.service';
import {
  BIG_CHANGE_RATIO, Currency, QUOTE_SECONDS, RATES_MAX_AGE_MS, WIDE_SPREAD_RATIO,
  exchangeError, formatMoney, isEligibleRole,
} from './exchange.rules';

const CURRENCIES: Currency[] = ['CDF', 'USD'];
/** A refused request can be sent again after this long (so the team is not asked again and again for the same person). */
const REREQUEST_AFTER_REFUSAL_MS = 24 * 3_600_000;
const MAX_REASON = 300;

export type VerificationStatus = 'none' | 'pending' | 'approved' | 'rejected' | 'revoked';

export interface LimitRow {
  currency: Currency;
  min_cents: number | null;
  max_cents: number | null;
  daily_max_cents: number | null;
  monthly_max_cents: number | null;
}

export interface RatesChange {
  buy_rate: number;
  sell_rate: number;
  market_rate?: number | null;
  confirm_large_change?: boolean;
}

/**
 * Bureau d'échange (migration 088): converts a wallet's CDF into USD and the reverse, at the rates the super admin
 * sets (a buying and a selling price, like an exchange office). The money moves in the database function
 * execute_exchange() — one transaction, limits checked under the wallet lock — this service guards the door
 * (role, validated account, PIN) and talks to the people.
 *
 * REGULATORY NOTE: exchanging currencies for the public, with a margin, is regulated by the Banque Centrale du Congo.
 * The service is delivered switched off; the super admin turns it on once the legal point is settled.
 */
@Injectable()
export class ExchangeService {
  private readonly logger = new Logger(ExchangeService.name);

  constructor(
    private supabase: SupabaseService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private alerts: SecurityAlertsService,
    private wallets: WalletsService,
    private pins: WalletPinService,
  ) {}

  private get db() {
    return this.supabase.getClient();
  }

  // ==========================================================================
  // What the app needs to know
  // ==========================================================================

  private async loadSettings() {
    const { data, error } = await this.db.from('exchange_settings').select('*').eq('id', 1).maybeSingle();
    if (error) {
      // Migration 088 not applied: the service simply does not exist yet.
      this.logger.warn(`exchange_settings unreadable: ${error.message}`);
      return null;
    }
    return data;
  }

  private ratesFresh(s: any, now = Date.now()): boolean {
    return !!s && s.buy_rate != null && s.sell_rate != null && !!s.rates_updated_at && now - new Date(s.rates_updated_at).getTime() < RATES_MAX_AGE_MS;
  }

  private async loadLimits(): Promise<Record<Currency, LimitRow>> {
    const { data } = await this.db.from('exchange_limits').select('*');
    const empty = (currency: Currency): LimitRow => ({ currency, min_cents: null, max_cents: null, daily_max_cents: null, monthly_max_cents: null });
    const out: Record<Currency, LimitRow> = { CDF: empty('CDF'), USD: empty('USD') };
    for (const r of data || []) {
      if (r.currency === 'CDF' || r.currency === 'USD') {
        const n = (v: unknown) => (v == null ? null : Number(v));
        out[r.currency as Currency] = { currency: r.currency, min_cents: n(r.min_cents), max_cents: n(r.max_cents), daily_max_cents: n(r.daily_max_cents), monthly_max_cents: n(r.monthly_max_cents) };
      }
    }
    return out;
  }

  private async verificationOf(userId: string): Promise<{ status: VerificationStatus; reason: string | null; requested_at: string | null; decided_at: string | null }> {
    const { data } = await this.db.from('exchange_verifications').select('status, reason, requested_at, decided_at').eq('user_id', userId).maybeSingle();
    if (!data) return { status: 'none', reason: null, requested_at: null, decided_at: null };
    return { status: data.status as VerificationStatus, reason: data.reason ?? null, requested_at: data.requested_at, decided_at: data.decided_at ?? null };
  }

  /**
   * The state of the Bureau d'échange for this person: should the button exist, may they use it, what are the rates
   * and how much of today's limit is left. Nothing sensitive: the rates are what the person is offered anyway.
   */
  async getState(userId: string, role: string | undefined) {
    const eligible = isEligibleRole(role);
    const settings = await this.loadSettings();
    const enabled = !!settings?.enabled;
    // No button for employees, nor while the team has not switched the service on.
    if (!eligible || !enabled) return { eligible, enabled: eligible && enabled, available: false, paused: false, quote_seconds: QUOTE_SECONDS };

    const paused = !this.ratesFresh(settings);
    const verification = await this.verificationOf(userId);
    const limits = await this.loadLimits();
    const wallet = await this.wallets.getWalletByUserId(userId);
    const { data: usage } = await this.db.rpc('exchange_usage', { p_wallet: wallet.id });
    const used: Record<string, { day: number; month: number }> = {};
    for (const u of usage || []) used[u.currency] = { day: Number(u.day_cents) || 0, month: Number(u.month_cents) || 0 };

    const withUsage = (c: Currency) => ({
      ...limits[c],
      used_today_cents: used[c]?.day ?? 0,
      used_month_cents: used[c]?.month ?? 0,
    });

    return {
      eligible: true,
      enabled: true,
      paused,
      available: !paused && verification.status === 'approved',
      quote_seconds: QUOTE_SECONDS,
      verification,
      rates: paused ? null : { buy: Number(settings.buy_rate), sell: Number(settings.sell_rate), updated_at: settings.rates_updated_at },
      limits: { CDF: withUsage('CDF'), USD: withUsage('USD') },
    };
  }

  // ==========================================================================
  // Validation of the account (v1: the team validates by hand)
  // ==========================================================================

  async requestVerification(userId: string, role: string | undefined) {
    this.assertEligible(role);
    const settings = await this.loadSettings();
    if (!settings?.enabled) throw new ForbiddenException("Le Bureau d'échange n'est pas disponible pour le moment.");

    const current = await this.verificationOf(userId);
    if (current.status === 'approved' || current.status === 'pending') return { status: current.status };
    if (current.status === 'rejected') {
      const at = current.decided_at ? new Date(current.decided_at).getTime() : 0;
      if (Date.now() - at < REREQUEST_AFTER_REFUSAL_MS) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'EXCHANGE_VERIFICATION_REFUSED_RECENTLY',
          message: `Votre dernière demande a été refusée${current.reason ? ` (${current.reason})` : ''}. Vous pourrez en envoyer une nouvelle demain.`,
        });
      }
    }

    const { error } = await this.db.from('exchange_verifications').upsert(
      { user_id: userId, status: 'pending', requested_at: new Date().toISOString(), decided_at: null, decided_by: null, reason: null },
      { onConflict: 'user_id' },
    );
    if (error) throw new Error(`Failed to save exchange verification request: ${error.message}`);

    const { data: profile } = await this.db.from('profiles').select('full_name, phone, email').eq('id', userId).maybeSingle();
    await this.audit.log({ user_id: userId, action: 'exchange_verification_requested', entity_type: 'exchange_verification', entity_id: userId });
    void this.alerts.alert({
      severity: 'info',
      audience: 'admins',
      title: "Demande de validation : Bureau d'échange",
      body: `${profile?.full_name || profile?.email || 'Un client'}${profile?.phone ? ` (${profile.phone})` : ''} demande à utiliser le Bureau d'échange. Administration → Bureau d'échange.`,
      dedupeKey: `exchange-verification:${userId}`,
      data: { kind: 'exchange_verification_request', user_id: userId },
    });
    return { status: 'pending' as VerificationStatus };
  }

  // ==========================================================================
  // Quote, then exchange
  // ==========================================================================

  private assertEligible(role: string | undefined) {
    if (!isEligibleRole(role)) throw new ForbiddenException("Le Bureau d'échange n'est pas ouvert à ce type de compte.");
  }

  private async activeWallet(userId: string) {
    const wallet = await this.wallets.getWalletByUserId(userId);
    if (wallet.status !== 'ACTIVE') throw new BadRequestException(`Votre portefeuille est ${wallet.status} : échange impossible.`);
    return wallet;
  }

  /** Fixes the rate for QUOTE_SECONDS and says exactly what the person would receive. */
  async createQuote(userId: string, role: string | undefined, dto: { from_currency: Currency; to_currency: Currency; amount_cents: number }) {
    this.assertEligible(role);
    const wallet = await this.activeWallet(userId);
    const { data, error } = await this.db.rpc('create_exchange_quote', {
      p_user: userId,
      p_wallet: wallet.id,
      p_from: dto.from_currency,
      p_to: dto.to_currency,
      p_from_cents: dto.amount_cents,
    });
    if (error) {
      const mapped = exchangeError(error.message, { fromCurrency: dto.from_currency });
      if (mapped) throw mapped;
      throw new Error(`Failed to create exchange quote: ${error.message}`);
    }
    const q = Array.isArray(data) ? data[0] : data;
    return {
      quote_id: q.id,
      from_currency: q.from_currency,
      to_currency: q.to_currency,
      from_cents: Number(q.from_cents),
      to_cents: Number(q.to_cents),
      rate: Number(q.rate),
      expires_at: q.expires_at,
      seconds: QUOTE_SECONDS,
    };
  }

  async execute(userId: string, role: string | undefined, dto: { quote_id: string; pin: string }, idempotencyKey: string) {
    this.assertEligible(role);
    const wallet = await this.activeWallet(userId);

    // The same request sent twice (a retry after a network cut) answers with the same exchange, without asking the PIN again.
    const { data: existing } = await this.db.from('exchanges').select('*').eq('idempotency_key', idempotencyKey).maybeSingle();
    if (existing) return this.replay(existing, wallet.id, dto.quote_id);

    await this.pins.verifyPin(userId, dto.pin);

    const { data, error } = await this.db.rpc('execute_exchange', {
      p_user: userId,
      p_wallet: wallet.id,
      p_quote: dto.quote_id,
      p_idempotency_key: idempotencyKey,
    });
    if (error) {
      let fromCurrency: string | undefined;
      if (/EXCHANGE_(MIN|MAX|DAILY|MONTHLY)|Insufficient balance/i.test(error.message)) {
        const { data: q } = await this.db.from('exchange_quotes').select('from_currency').eq('id', dto.quote_id).maybeSingle();
        fromCurrency = q?.from_currency;
      }
      const mapped = exchangeError(error.message, { fromCurrency });
      if (mapped) throw mapped;
      throw new Error(`Failed to execute exchange: ${error.message}`);
    }
    const ex = Array.isArray(data) ? data[0] : data;

    await this.audit.log({
      user_id: userId,
      action: 'exchange_done',
      entity_type: 'exchange',
      entity_id: ex.id,
      changes: { reference: ex.reference, from_currency: ex.from_currency, from_cents: Number(ex.from_cents), to_currency: ex.to_currency, to_cents: Number(ex.to_cents), rate: Number(ex.rate) },
    });
    await this.notifications.create({
      user_id: userId,
      type: 'exchange_done',
      title: 'Échange effectué',
      body: `${formatMoney(Number(ex.from_cents), ex.from_currency)} → ${formatMoney(Number(ex.to_cents), ex.to_currency)} (taux 1 $US = ${Number(ex.rate).toLocaleString('fr-FR')} CDF).`,
      data: { exchange_id: ex.id, reference: ex.reference },
    }).catch(() => null);

    return this.view(ex, wallet.id);
  }

  private async replay(existing: any, walletId: string, quoteId: string) {
    if (existing.wallet_id !== walletId || existing.quote_id !== quoteId) {
      throw new ConflictException("Cette clé d'idempotence a déjà été utilisée pour une autre opération.");
    }
    return { ...(await this.view(existing, walletId)), replayed: true };
  }

  private async view(ex: any, walletId: string) {
    return {
      exchange: {
        id: ex.id,
        reference: ex.reference,
        from_currency: ex.from_currency,
        to_currency: ex.to_currency,
        from_cents: Number(ex.from_cents),
        to_cents: Number(ex.to_cents),
        rate: Number(ex.rate),
        created_at: ex.created_at,
      },
      balances: await this.wallets.getBalances(walletId),
    };
  }

  // ==========================================================================
  // Administration
  // ==========================================================================

  /** Everything the super admin page shows: switch, rates, limits, figures and the history of the rates. */
  async adminOverview() {
    const settings = await this.loadSettings();
    if (!settings) throw new BadRequestException("La migration 088 (Bureau d'échange) n'est pas encore appliquée sur cette base.");
    const limits = await this.loadLimits();
    const { data: stats } = await this.db.rpc('exchange_stats');
    const s = (Array.isArray(stats) ? stats[0] : stats) || {};
    const { data: history } = await this.db.from('exchange_rate_history').select('*').order('created_at', { ascending: false }).limit(20);

    const ids = Array.from(new Set([settings.rates_updated_by, ...(history || []).map((h: any) => h.changed_by)].filter(Boolean)));
    const names = await this.namesOf(ids as string[]);
    const market = settings.market_rate != null ? Number(settings.market_rate) : null;
    const n = (v: unknown) => Number(v) || 0;

    return {
      enabled: !!settings.enabled,
      rates: {
        buy: settings.buy_rate != null ? Number(settings.buy_rate) : null,
        sell: settings.sell_rate != null ? Number(settings.sell_rate) : null,
        market,
        updated_at: settings.rates_updated_at,
        updated_by: settings.rates_updated_by ? names[settings.rates_updated_by] || null : null,
        fresh: this.ratesFresh(settings),
        expires_at: settings.rates_updated_at ? new Date(new Date(settings.rates_updated_at).getTime() + RATES_MAX_AGE_MS).toISOString() : null,
      },
      limits: Object.values(limits),
      stats: {
        gain_today_cdf_cents: n(s.gain_today_cdf_cents),
        gain_7d_cdf_cents: n(s.gain_7d_cdf_cents),
        gain_total_cdf_cents: n(s.gain_total_cdf_cents),
        count_today: n(s.count_today),
        count_7d: n(s.count_7d),
        volume_7d_usd_cents: n(s.volume_7d_usd_cents),
      },
      history: (history || []).map((h: any) => ({
        id: h.id,
        created_at: h.created_at,
        changed_by: h.changed_by ? names[h.changed_by] || null : null,
        buy_rate: Number(h.buy_rate),
        sell_rate: Number(h.sell_rate),
        previous_buy_rate: h.previous_buy_rate != null ? Number(h.previous_buy_rate) : null,
        previous_sell_rate: h.previous_sell_rate != null ? Number(h.previous_sell_rate) : null,
      })),
    };
  }

  private async namesOf(ids: string[]): Promise<Record<string, string>> {
    if (ids.length === 0) return {};
    const { data } = await this.db.from('profiles').select('id, full_name, email').in('id', ids);
    return Object.fromEntries((data || []).map((p: any) => [p.id, p.full_name || p.email]));
  }

  async setRates(adminId: string, dto: RatesChange) {
    const { buy_rate: buy, sell_rate: sell } = dto;
    const market = dto.market_rate ?? null;
    if (buy > sell) throw new BadRequestException("Le prix d'achat ne peut pas dépasser le prix de vente : sinon vous perdriez de l'argent à chaque échange.");
    if (market != null && (market < buy || market > sell)) {
      throw new BadRequestException("Le taux du marché doit se trouver entre le prix d'achat et le prix de vente.");
    }

    const settings = await this.loadSettings();
    if (!settings) throw new BadRequestException("La migration 088 (Bureau d'échange) n'est pas encore appliquée sur cette base.");

    // A slip of the finger (28200 instead of 2820) would sell francs for nothing: ask twice for anything far from what was there.
    if (!dto.confirm_large_change) {
      const far = (now: number, before: unknown) => before != null && Math.abs(now - Number(before)) / Number(before) > BIG_CHANGE_RATIO;
      if (far(buy, settings.buy_rate) || far(sell, settings.sell_rate)) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'EXCHANGE_RATE_BIG_CHANGE',
          message: `Ces taux sont très différents des précédents (${settings.buy_rate} / ${settings.sell_rate}). Vérifiez qu'il n'y a pas d'erreur de frappe, puis confirmez.`,
        });
      }
      if ((sell - buy) / buy > WIDE_SPREAD_RATIO) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'EXCHANGE_RATE_BIG_CHANGE',
          message: `L'écart entre achat et vente dépasse ${Math.round(WIDE_SPREAD_RATIO * 100)} % : les clients trouveront ce prix très élevé. Confirmez si c'est voulu.`,
        });
      }
    }

    const now = new Date().toISOString();
    const { error } = await this.db.from('exchange_settings')
      .update({ buy_rate: buy, sell_rate: sell, market_rate: market, rates_updated_at: now, rates_updated_by: adminId, updated_at: now })
      .eq('id', 1);
    if (error) throw new Error(`Failed to save exchange rates: ${error.message}`);
    await this.db.from('exchange_rate_history').insert({
      buy_rate: buy, sell_rate: sell, market_rate: market,
      previous_buy_rate: settings.buy_rate, previous_sell_rate: settings.sell_rate, changed_by: adminId,
    });

    await this.audit.log({
      user_id: adminId,
      action: 'exchange_rates_updated',
      entity_type: 'exchange_settings',
      changes: { before: { buy: settings.buy_rate, sell: settings.sell_rate, market: settings.market_rate }, after: { buy, sell, market } },
    });
    void this.alerts.alert({
      severity: 'warning',
      title: "Taux du Bureau d'échange modifiés",
      body: `Achat ${buy} CDF / vente ${sell} CDF pour 1 $US (avant : ${settings.buy_rate ?? '—'} / ${settings.sell_rate ?? '—'}).`,
      excludeUserId: adminId,
    });
    return this.adminOverview();
  }

  async setEnabled(adminId: string, enabled: boolean) {
    const settings = await this.loadSettings();
    if (!settings) throw new BadRequestException("La migration 088 (Bureau d'échange) n'est pas encore appliquée sur cette base.");
    if (enabled && !this.ratesFresh(settings)) {
      throw new BadRequestException("Fixez d'abord les taux du jour (achat et vente) : le service ne peut s'ouvrir qu'avec des taux à jour.");
    }
    const { error } = await this.db.from('exchange_settings').update({ enabled, updated_at: new Date().toISOString() }).eq('id', 1);
    if (error) throw new Error(`Failed to switch the exchange service: ${error.message}`);
    await this.audit.log({ user_id: adminId, action: enabled ? 'exchange_enabled' : 'exchange_disabled', entity_type: 'exchange_settings' });
    void this.alerts.alert({
      severity: 'warning',
      title: enabled ? "Bureau d'échange ouvert" : "Bureau d'échange fermé",
      body: enabled ? "Les clients validés peuvent maintenant échanger leurs devises." : "Plus aucun échange n'est possible.",
      excludeUserId: adminId,
    });
    return this.adminOverview();
  }

  async setLimits(adminId: string, currency: string, dto: Partial<Omit<LimitRow, 'currency'>>) {
    if (!CURRENCIES.includes(currency as Currency)) throw new BadRequestException('Devise inconnue.');
    const limits = await this.loadLimits();
    const before = limits[currency as Currency];
    const merged = { ...before, ...Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) } as LimitRow;
    if (merged.max_cents != null && merged.min_cents != null && merged.min_cents > merged.max_cents) {
      throw new BadRequestException('Le minimum ne peut pas dépasser le maximum par échange.');
    }
    if (merged.daily_max_cents != null && merged.max_cents != null && merged.daily_max_cents < merged.max_cents) {
      throw new BadRequestException('La limite du jour ne peut pas être inférieure au maximum par échange.');
    }
    if (merged.monthly_max_cents != null && merged.daily_max_cents != null && merged.monthly_max_cents < merged.daily_max_cents) {
      throw new BadRequestException('La limite du mois ne peut pas être inférieure à la limite du jour.');
    }
    const { error } = await this.db.from('exchange_limits').upsert(
      {
        currency,
        min_cents: merged.min_cents, max_cents: merged.max_cents, daily_max_cents: merged.daily_max_cents, monthly_max_cents: merged.monthly_max_cents,
        updated_at: new Date().toISOString(), updated_by: adminId,
      },
      { onConflict: 'currency' },
    );
    if (error) throw new Error(`Failed to save exchange limits: ${error.message}`);
    await this.audit.log({ user_id: adminId, action: 'exchange_limits_updated', entity_type: 'exchange_limits', entity_id: currency, changes: { before, after: merged } });
    void this.alerts.alert({
      severity: 'warning',
      title: "Limites du Bureau d'échange modifiées",
      body: `Limites ${currency} modifiées.`,
      excludeUserId: adminId,
    });
    return this.adminOverview();
  }

  /** Requests waiting for the team, and the accounts already decided. */
  async listVerifications(status?: string) {
    let q = this.db.from('exchange_verifications').select('*').order('requested_at', { ascending: false }).limit(200);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw new Error(`Failed to list exchange verifications: ${error.message}`);
    const rows = data || [];
    const ids = rows.map((r: any) => r.user_id);
    const { data: profiles } = ids.length
      ? await this.db.from('profiles').select('id, full_name, email, phone').in('id', ids)
      : { data: [] as any[] };
    const { data: roles } = ids.length
      ? await this.db.from('user_roles').select('user_id, role:roles(slug)').in('user_id', ids)
      : { data: [] as any[] };
    const profileOf = new Map((profiles || []).map((p: any) => [p.id, p]));
    const roleOf = new Map<string, string>();
    for (const r of roles || []) roleOf.set((r as any).user_id, (r as any).role?.slug);
    return rows.map((r: any) => {
      const p: any = profileOf.get(r.user_id) || {};
      return {
        user_id: r.user_id,
        status: r.status,
        requested_at: r.requested_at,
        decided_at: r.decided_at,
        reason: r.reason,
        full_name: p.full_name || null,
        email: p.email || null,
        phone: p.phone || null,
        role: roleOf.get(r.user_id) || null,
      };
    });
  }

  private async decide(adminId: string, userId: string, from: string[], to: 'approved' | 'rejected' | 'revoked', reason: string | null) {
    const { data, error } = await this.db.from('exchange_verifications')
      .update({ status: to, decided_at: new Date().toISOString(), decided_by: adminId, reason })
      .eq('user_id', userId)
      .in('status', from)
      .select('user_id');
    if (error) throw new Error(`Failed to update exchange verification: ${error.message}`);
    if (!data || data.length === 0) throw new ConflictException('Cette demande a déjà été traitée ou n\'existe pas.');
    await this.audit.log({ user_id: adminId, action: `exchange_verification_${to}`, entity_type: 'exchange_verification', entity_id: userId, changes: { reason } });
  }

  async approve(adminId: string, userId: string) {
    await this.decide(adminId, userId, ['pending', 'rejected', 'revoked'], 'approved', null);
    await this.notifications.create({
      user_id: userId,
      type: 'exchange_verification',
      title: "Bureau d'échange activé",
      body: "Votre compte est validé : vous pouvez maintenant échanger vos francs et vos dollars.",
      data: { status: 'approved' },
    }).catch(() => null);
    return { status: 'approved' };
  }

  async reject(adminId: string, userId: string, reason: string) {
    const clean = (reason || '').trim().slice(0, MAX_REASON);
    if (clean.length < 3) throw new BadRequestException('Indiquez le motif du refus (il sera montré au client).');
    await this.decide(adminId, userId, ['pending'], 'rejected', clean);
    await this.notifications.create({
      user_id: userId,
      type: 'exchange_verification',
      title: 'Demande de validation refusée',
      body: `Votre demande pour le Bureau d'échange n'a pas été acceptée : ${clean}`,
      data: { status: 'rejected' },
    }).catch(() => null);
    return { status: 'rejected' };
  }

  async revoke(adminId: string, userId: string, reason?: string) {
    const clean = (reason || '').trim().slice(0, MAX_REASON) || null;
    await this.decide(adminId, userId, ['approved'], 'revoked', clean);
    await this.notifications.create({
      user_id: userId,
      type: 'exchange_verification',
      title: "Bureau d'échange désactivé",
      body: `L'accès au Bureau d'échange a été retiré à votre compte${clean ? ` : ${clean}` : '.'}`,
      data: { status: 'revoked' },
    }).catch(() => null);
    return { status: 'revoked' };
  }
}
