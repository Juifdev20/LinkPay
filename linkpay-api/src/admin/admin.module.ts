import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { TreasuryService } from './treasury.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [SupabaseModule, AuditModule],
  controllers: [AdminController],
  providers: [AdminService, TreasuryService],
  exports: [AdminService],
})
export class AdminModule {}
