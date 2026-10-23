import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SalesService } from './sales.service';
import { JobLockService } from '../common/job-lock/job-lock.service';

/** Every minute: the Ventes sales whose payment QR expired unpaid (SALE_QR_TTL_MS) are cancelled. */
@Injectable()
export class SalesExpiryService {
  private readonly logger = new Logger(SalesExpiryService.name);
  private running = false;

  constructor(
    private sales: SalesService,
    @Optional() private jobLock?: JobLockService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run(): Promise<number> {
    if (this.running) return 0;
    if (this.jobLock && !(await this.jobLock.acquire('sales-qr-expiry', 50))) return 0;
    this.running = true;
    try {
      const count = await this.sales.expireOverdueSales();
      if (count) this.logger.log(`${count} vente(s) expirée(s) annulée(s)`);
      return count;
    } catch (err: any) {
      this.logger.error(`Sales expiry failed: ${err.message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
