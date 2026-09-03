import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
