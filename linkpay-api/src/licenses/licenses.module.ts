import { Global, Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';
import { WalletsModule } from '../wallets/wallets.module';
import { LicensesService } from './licenses.service';
import { LicenseGuard } from './license.guard';
import { LicensesController, LicensesAdminController } from './licenses.controller';

/** Global so any controller can use @RequireLicense without importing this module. */
@Global()
@Module({
  imports: [SupabaseModule, NotificationsModule, AuditModule, WalletsModule],
  controllers: [LicensesController, LicensesAdminController],
  providers: [LicensesService, LicenseGuard],
  exports: [LicensesService, LicenseGuard],
})
export class LicensesModule {}
