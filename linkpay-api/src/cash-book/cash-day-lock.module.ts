import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { CashDayLockService } from './cash-day-lock.service';

@Module({
  imports: [SupabaseModule],
  providers: [CashDayLockService],
  exports: [CashDayLockService],
})
export class CashDayLockModule {}
