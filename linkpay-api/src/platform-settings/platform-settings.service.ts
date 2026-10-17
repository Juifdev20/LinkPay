import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { AuditService } from '../audit/audit.service';

/**
 * Platform-wide switches decided by the super admin (single row, id = 1 —
 * see migration 039). Today: screenshot protection for the Android app.
 */
@Injectable()
export class PlatformSettingsService {
  private readonly logger = new Logger(PlatformSettingsService.name);

  constructor(
    private supabaseService: SupabaseService,
    private auditService: AuditService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  /** Full row, for the super admin screen (who changed it, when). */
  async getSettings() {
    const { data, error } = await this.db
      .from('platform_settings')
      .select('screenshot_protection, updated_at, updated_by')
      .eq('id', 1)
      .maybeSingle();
    if (error) {
      // Table not migrated yet → behave as "everything off" rather than
      // breaking every app launch.
      this.logger.warn(`platform_settings unreadable: ${error.message}`);
      return { screenshot_protection: false, updated_at: null, updated_by: null };
    }
    return data || { screenshot_protection: false, updated_at: null, updated_by: null };
  }

  /** What every app needs at launch — public, nothing sensitive in it. */
  async getPublicSettings() {
    const { screenshot_protection } = await this.getSettings();
    return { screenshot_protection: !!screenshot_protection };
  }

  async update(callerId: string, changes: { screenshot_protection: boolean }) {
    const before = await this.getSettings();
    const { data, error } = await this.db
      .from('platform_settings')
      .upsert({
        id: 1,
        screenshot_protection: changes.screenshot_protection,
        updated_at: new Date().toISOString(),
        updated_by: callerId,
      })
      .select('screenshot_protection, updated_at, updated_by')
      .single();
    if (error) {
      if (/platform_settings/.test(error.message) && /schema cache|does not exist/.test(error.message)) {
        throw new ServiceUnavailableException(
          "La table platform_settings n'existe pas encore — appliquez la migration 039_platform_settings.sql dans l'éditeur SQL de Supabase.",
        );
      }
      throw new Error(`Failed to update platform settings: ${error.message}`);
    }

    if (before.screenshot_protection !== changes.screenshot_protection) {
      await this.auditService.log({
        user_id: callerId,
        action: 'screenshot_protection_changed',
        entity_type: 'platform_settings',
        entity_id: '1',
        changes: { from: !!before.screenshot_protection, to: changes.screenshot_protection },
      });
    }
    return data;
  }
}
