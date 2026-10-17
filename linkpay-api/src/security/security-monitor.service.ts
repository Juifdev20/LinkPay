import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '../supabase/supabase.service';
import { SecurityAlertsService } from './security-alerts.service';
import { JobLockService } from '../common/job-lock/job-lock.service';

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
    @Optional() private jobLock?: JobLockService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async checkLedgerIntegrity(): Promise<number> {
    // One API instance per run, so a negative balance raises one alert, not one per instance (migration 053).
    if (this.jobLock && !(await this.jobLock.acquire('ledger-integrity', 540))) return 0;
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
