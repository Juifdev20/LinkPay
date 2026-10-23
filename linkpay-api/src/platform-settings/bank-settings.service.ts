import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { BANKS } from '../wallets/bank-account';

/**
 * Which banks the customers can pick for a withdrawal or a merchant settlement. The super admin switches banks of the catalogue
 * on and off (single row, platform_settings.withdrawal_banks, migration 061). Nothing chosen yet, or the column not migrated yet
 * = the whole catalogue is offered, so the feature never breaks because of a missing setting.
 */
@Injectable()
export class BankSettingsService {
  private readonly logger = new Logger(BankSettingsService.name);

  constructor(
    private supabaseService: SupabaseService,
    private auditService: AuditService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  /** The banks switched on, in the order of the catalogue. */
  async enabledBanks(): Promise<string[]> {
    const { data, error } = await this.db.from('platform_settings').select('withdrawal_banks').eq('id', 1).maybeSingle();
    if (error) {
      this.logger.warn(`withdrawal_banks unreadable, offering every bank: ${error.message}`);
      return [...BANKS];
    }
    const chosen: unknown = data?.withdrawal_banks;
    if (!Array.isArray(chosen)) return [...BANKS];
    return BANKS.filter((b) => chosen.includes(b));
  }

  /** For the super admin screen: every bank of the catalogue and whether it is switched on. */
  async adminView() {
    const enabled = new Set(await this.enabledBanks());
    return { banks: BANKS.map((name) => ({ name, enabled: enabled.has(name) })) };
  }

  async setEnabled(callerId: string, names: string[]) {
    const wanted = [...new Set((names || []).map((n) => String(n)))];
    const unknown = wanted.filter((n) => !BANKS.includes(n));
    if (unknown.length) throw new BadRequestException(`Banque inconnue : ${unknown[0]}.`);
    if (wanted.length === 0) throw new BadRequestException('Gardez au moins une banque : sinon plus personne ne peut retirer vers une banque.');
    const before = await this.enabledBanks();
    const ordered = BANKS.filter((b) => wanted.includes(b));
    const { error } = await this.db
      .from('platform_settings')
      .upsert({ id: 1, withdrawal_banks: ordered, updated_at: new Date().toISOString(), updated_by: callerId });
    if (error) {
      if (/withdrawal_banks/.test(error.message) && /schema cache|does not exist|column/.test(error.message)) {
        throw new ServiceUnavailableException("La colonne withdrawal_banks n'existe pas encore — appliquez la migration 061_withdrawal_banks.sql dans l'éditeur SQL de Supabase.");
      }
      throw new Error(`Failed to save the banks: ${error.message}`);
    }
    await this.auditService.log({
      user_id: callerId, action: 'withdrawal_banks_changed', entity_type: 'platform_settings', entity_id: '1',
      changes: { from: before, to: ordered },
    });
    return this.adminView();
  }
}
