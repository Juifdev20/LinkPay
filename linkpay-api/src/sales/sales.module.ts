import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { StockModule } from '../stock/stock.module';
import { CashDayLockModule } from '../cash-book/cash-day-lock.module';
import { AuditModule } from '../audit/audit.module';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { SalesExpiryService } from './sales-expiry.service';

@Module({
  imports: [SupabaseModule, StockModule, AuditModule, CashDayLockModule],
  controllers: [SalesController],
  providers: [SalesService, SalesExpiryService],
  exports: [SalesService],
})
export class SalesModule {}
