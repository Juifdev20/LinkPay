import { Module } from '@nestjs/common';
import { PlatformSettingsController } from './platform-settings.controller';
import { PlatformSettingsService } from './platform-settings.service';
import { BankSettingsService } from './bank-settings.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule, SupabaseModule],
  controllers: [PlatformSettingsController],
  providers: [PlatformSettingsService, BankSettingsService],
  exports: [BankSettingsService],
})
export class PlatformSettingsModule {}
