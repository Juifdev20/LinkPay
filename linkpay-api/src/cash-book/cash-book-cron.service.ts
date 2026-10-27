import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { JobLockService } from '../common/job-lock/job-lock.service';
import { CashBookService } from './cash-book.service';

/** Every evening at 21:30 (Kinshasa): stations that took cash today but have not closed the day are reminded. */
@Injectable()
export class CashBookCronService {
  private readonly logger = new Logger(CashBookCronService.name);

  constructor(
    private cashBook: CashBookService,
    @Optional() private jobLock?: JobLockService,
  ) {}

  @Cron('30 21 * * *', { timeZone: 'Africa/Kinshasa' })
  async remindUnclosed(): Promise<number> {
    if (this.jobLock && !(await this.jobLock.acquire('cash-day-closing-reminder', 3600))) return 0;
    const reminded = await this.cashBook.remindUnclosedStations();
    this.logger.log(`Cash closing reminders sent for ${reminded} station-currency pair(s)`);
    return reminded;
  }
}
