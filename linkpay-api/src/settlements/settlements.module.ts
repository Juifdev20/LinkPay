import { Module } from '@nestjs/common';
import { SettlementsController } from './settlements.controller';
import { SettlementsService } from './settlements.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [SupabaseModule, LedgerModule],
  controllers: [SettlementsController],
  providers: [SettlementsService],
  exports: [SettlementsService],
})
export class SettlementsModule {}
