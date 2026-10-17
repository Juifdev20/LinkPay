import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { JobLockService } from '../common/job-lock/job-lock.service';

/**
 * Every minute, settles the payments of the configured provider that are still waiting (see PaymentsService.reconcilePending).
 * One API instance per minute (migration 053); a run never overlaps the previous one.
 */
@Injectable()
export class PendingPaymentsReconciliationService {
  private readonly logger = new Logger(PendingPaymentsReconciliationService.name);
  private running = false;

  constructor(
    private payments: PaymentsService,
    private config: ConfigService,
    @Optional() private jobLock?: JobLockService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run(): Promise<{ checked: number; settled: number }> {
    const provider = this.config.get<string>('PSP_PROVIDER', 'mock');
    if (this.running || provider === 'mock') return { checked: 0, settled: 0 };
    if (this.jobLock && !(await this.jobLock.acquire('psp-reconcile', 50))) return { checked: 0, settled: 0 };
    this.running = true;
    try {
      return await this.payments.reconcilePending(provider);
    } catch (err: any) {
      this.logger.error(`Reconciliation failed: ${err.message}`);
      return { checked: 0, settled: 0 };
    } finally {
      this.running = false;
    }
  }
}
