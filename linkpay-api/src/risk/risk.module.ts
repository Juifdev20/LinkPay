import { Module } from '@nestjs/common';
import { RiskService } from './risk.service';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  providers: [RiskService],
  exports: [RiskService],
})
export class RiskModule {}
