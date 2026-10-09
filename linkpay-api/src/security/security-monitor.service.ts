import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '../supabase/supabase.service';
import { SecurityAlertsService } from './security-alerts.service';

/**
 * Watches the books. Every wallet balance is the sum of its ledger entries,
 * and the API never lets a debit exceed the balance — so a wallet below zero
 * means money was created from nothing (a bug, or someone got around the API).
 * It is the one signal that catches an attack nobody anticipated.
 */
@Injectable()
export class SecurityMonitorService {
  private readonly logger = new Logger(SecurityMonitorService.name);

  constructor(
    private supabaseService: SupabaseService,
    private alerts: SecurityAlertsService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async checkLedgerIntegrity(): Promise<number> {
    const { data, error } = await this.supabaseService.getClient().rpc('negative_wallet_balances');
    if (error) {
      this.logger.error(`Ledger integrity check failed to run: ${error.message}`);
      return 0;
    }
    const rows: any[] = data || [];
    if (rows.length > 0) {
      await this.alerts.alert({
        severity: 'critical',
        title: 'Portefeuille en négatif détecté',
        body: `${rows.length} portefeuille(s) ont un solde négatif dans le grand livre (ex. ${rows[0].wallet_id}). De l'argent a peut-être été créé : vérifiez ledger_entries immédiatement.`,
        dedupeKey: 'ledger-negative',
        data: { wallets: rows.slice(0, 10) },
      });
    }
    return rows.length;
  }
}
