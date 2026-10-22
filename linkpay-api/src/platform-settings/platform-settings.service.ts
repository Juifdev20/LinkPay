import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { TwoFactorService } from '../security/two-factor.service';
import { SecurityAlertsService } from '../security/security-alerts.service';

const SUPPORT_KEYS = ['support_phone', 'support_whatsapp', 'support_email'] as const;
type SupportKey = (typeof SUPPORT_KEYS)[number];
const NO_SUPPORT: Record<SupportKey, null> = { support_phone: null, support_whatsapp: null, support_email: null };

export type PlatformSettings = {
  screenshot_protection: boolean;
  cdf_per_usd: number | null;
  /** Until when the administrators' second factor is suspended (null = required) — migration 081. */
  admin_2fa_paused_until: string | null;
  admin_2fa_paused_by: string | null;
  updated_at: string | null;
  updated_by: string | null;
} & Record<SupportKey, string | null>;

type SettingsChanges = { screenshot_protection?: boolean; cdf_per_usd?: number | null } & Partial<Record<SupportKey, string | null>>;

/**
 * Platform-wide switches decided by the super admin (single row, id = 1 —
 * see migration 039): screenshot protection for the Android app, the indicative
 * rate (072) and the support contacts shown in the app (080).
 */
@Injectable()
export class PlatformSettingsService {
  private readonly logger = new Logger(PlatformSettingsService.name);

  constructor(
    private supabaseService: SupabaseService,
    private auditService: AuditService,
    private twoFactor: TwoFactorService,
    private securityAlerts: SecurityAlertsService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  /** Full row, for the super admin screen (who changed it, when). */
  async getSettings(): Promise<PlatformSettings> {
    // '*': a column whose migration isn't applied yet (072, 080) just reads as "not set" instead of failing.
    const { data, error } = await this.db.from('platform_settings').select('*').eq('id', 1).maybeSingle();
    if (error) {
      // Table not migrated yet → behave as "everything off" rather than
      // breaking every app launch.
      this.logger.warn(`platform_settings unreadable: ${error.message}`);
      return { screenshot_protection: false, cdf_per_usd: null, ...NO_SUPPORT, admin_2fa_paused_until: null, admin_2fa_paused_by: null, updated_at: null, updated_by: null };
    }
    const row: any = data || {};
    return {
      screenshot_protection: !!row.screenshot_protection,
      cdf_per_usd: row.cdf_per_usd != null ? Number(row.cdf_per_usd) : null,
      support_phone: row.support_phone ?? null,
      support_whatsapp: row.support_whatsapp ?? null,
      support_email: row.support_email ?? null,
      // A date already passed means "required again": shown as such.
      admin_2fa_paused_until: row.admin_2fa_paused_until && new Date(row.admin_2fa_paused_until).getTime() > Date.now() ? row.admin_2fa_paused_until : null,
      admin_2fa_paused_by: row.admin_2fa_paused_by ?? null,
      updated_at: row.updated_at ?? null,
      updated_by: row.updated_by ?? null,
    };
  }

  /** What every app needs at launch — public, nothing sensitive in it (the support contacts are meant to be seen). */
  async getPublicSettings() {
    const { screenshot_protection, cdf_per_usd, support_phone, support_whatsapp, support_email } = await this.getSettings();
    return { screenshot_protection: !!screenshot_protection, cdf_per_usd, support: { phone: support_phone, whatsapp: support_whatsapp, email: support_email } };
  }

  async update(callerId: string, changes: SettingsChanges) {
    const before = await this.getSettings();
    // An emptied field means "no longer shown".
    const support = Object.fromEntries(
      SUPPORT_KEYS.filter((k) => changes[k] !== undefined).map((k) => [k, changes[k]?.trim().replace(/\s+/g, ' ') || null]),
    ) as Partial<Record<SupportKey, string | null>>;
    const next = {
      screenshot_protection: changes.screenshot_protection ?? before.screenshot_protection,
      ...(changes.cdf_per_usd !== undefined ? { cdf_per_usd: changes.cdf_per_usd } : {}),
      ...support,
    };
    const { data, error } = await this.db
      .from('platform_settings')
      .upsert({
        id: 1,
        ...next,
        updated_at: new Date().toISOString(),
        updated_by: callerId,
      })
      .select('*')
      .single();
    if (error) {
      if (/platform_settings/.test(error.message) && /schema cache|does not exist/.test(error.message)) {
        throw new ServiceUnavailableException(
          "La table platform_settings n'existe pas encore — appliquez la migration 039_platform_settings.sql dans l'éditeur SQL de Supabase.",
        );
      }
      if (/support_(phone|whatsapp|email)/.test(error.message)) {
        throw new ServiceUnavailableException("Les contacts du support n'existent pas encore — appliquez la migration 080_support_contacts.sql.");
      }
      if (/cdf_per_usd/.test(error.message)) {
        throw new ServiceUnavailableException("Le taux indicatif n'existe pas encore — appliquez la migration 072_indicative_exchange_rate.sql.");
      }
      throw new Error(`Failed to update platform settings: ${error.message}`);
    }

    if (before.screenshot_protection !== next.screenshot_protection) {
      await this.auditService.log({
        user_id: callerId,
        action: 'screenshot_protection_changed',
        entity_type: 'platform_settings',
        entity_id: '1',
        changes: { from: !!before.screenshot_protection, to: next.screenshot_protection },
      });
    }
    if (changes.cdf_per_usd !== undefined && changes.cdf_per_usd !== before.cdf_per_usd) {
      await this.auditService.log({
        user_id: callerId,
        action: 'indicative_rate_changed',
        entity_type: 'platform_settings',
        entity_id: '1',
        changes: { from: before.cdf_per_usd, to: changes.cdf_per_usd },
      });
    }
    const changedSupport = SUPPORT_KEYS.filter((k) => k in support && support[k] !== before[k]);
    if (changedSupport.length) {
      await this.auditService.log({
        user_id: callerId,
        action: 'support_contacts_changed',
        entity_type: 'platform_settings',
        entity_id: '1',
        changes: Object.fromEntries(changedSupport.map((k) => [k, { from: before[k], to: support[k] }])),
      });
    }
    return data;
  }

  /**
   * Suspends the administrators' second factor for `hours` (it comes back by itself then), or turns it back on now
   * (`hours` = 0). Every super admin is alerted either way: a suspension nobody expected is an attack sign.
   */
  async setAdminTwoFactorPause(callerId: string, hours: number) {
    const until = hours > 0 ? new Date(Date.now() + hours * 3600_000).toISOString() : null;
    const { error } = await this.db
      .from('platform_settings')
      .upsert({ id: 1, admin_2fa_paused_until: until, admin_2fa_paused_by: until ? callerId : null, updated_at: new Date().toISOString(), updated_by: callerId });
    if (error) {
      if (/admin_2fa_paused/.test(error.message)) {
        throw new ServiceUnavailableException("La suspension de la double authentification n'existe pas encore — appliquez la migration 081_admin_2fa_pause.sql.");
      }
      throw new Error(`Failed to change the admin 2FA requirement: ${error.message}`);
    }
    this.twoFactor.forgetAdminPause();

    await this.auditService.log({
      user_id: callerId,
      action: until ? 'admin_2fa_paused' : 'admin_2fa_resumed',
      entity_type: 'platform_settings',
      entity_id: '1',
      changes: { paused_until: until },
    });
    const { data: who } = await this.db.from('profiles').select('full_name, email').eq('id', callerId).maybeSingle();
    const name = (who as any)?.full_name || (who as any)?.email || 'Un super admin';
    void this.securityAlerts.alert({
      severity: until ? 'warning' : 'info',
      title: until ? 'Double authentification des administrateurs suspendue' : 'Double authentification des administrateurs réactivée',
      body: until
        ? `${name} l'a suspendue jusqu'au ${new Date(until).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' })} : le mot de passe suffit pour entrer dans l'administration. Si ce n'est pas voulu, réactivez-la dans Sécurité de l'application.`
        : `${name} l'a réactivée : le code de l'application d'authentification est de nouveau demandé.`,
    });
    return this.getSettings();
  }
}
