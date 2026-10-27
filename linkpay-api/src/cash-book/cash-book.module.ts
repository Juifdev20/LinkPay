import { Module } from '@nestjs/common';
import { CashBookController } from './cash-book.controller';
import { CashBookService } from './cash-book.service';
import { CashUnlockService } from './cash-unlock.service';
import { CashDayLockModule } from './cash-day-lock.module';
import { CashBookCronService } from './cash-book-cron.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { StockModule } from '../stock/stock.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [SupabaseModule, StockModule, AuditModule, NotificationsModule, CashDayLockModule],
  controllers: [CashBookController],
  providers: [CashBookService, CashUnlockService, CashBookCronService],
  exports: [CashBookService, CashUnlockService],
})
export class CashBookModule {}
