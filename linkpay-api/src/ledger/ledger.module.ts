import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
