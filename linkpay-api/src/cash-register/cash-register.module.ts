import { Module } from '@nestjs/common';
import { CashRegisterController } from './cash-register.controller';
import { CashRegisterService } from './cash-register.service';
import { CashDayLockModule } from '../cash-book/cash-day-lock.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { StockModule } from '../stock/stock.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [SupabaseModule, StockModule, AuditModule, NotificationsModule, CashDayLockModule],
  controllers: [CashRegisterController],
  providers: [CashRegisterService],
  exports: [CashRegisterService],
})
export class CashRegisterModule {}
