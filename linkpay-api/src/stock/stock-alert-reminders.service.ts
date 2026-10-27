import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StockService } from './stock.service';

/** Every hour: announces again the articles that are still low and were last announced more than 24 h ago (see StockService.sendLowStockReminders). */
@Injectable()
export class StockAlertRemindersService {
  private readonly logger = new Logger(StockAlertRemindersService.name);

  constructor(private stockService: StockService) {}

  @Cron('7 * * * *')
  async run() {
    try {
      const n = await this.stockService.sendLowStockReminders();
      if (n > 0) this.logger.log(`Stock reminders sent for ${n} article(s)`);
    } catch (err: any) {
      this.logger.error(`Stock reminders failed: ${err?.message}`);
    }
  }
}
