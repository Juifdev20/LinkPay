import { Module } from '@nestjs/common';
import { OrganizationStaffController } from './organization-staff.controller';
import { CashierPinController } from './cashier-pin.controller';
import { OrganizationStaffService } from './organization-staff.service';
import { CashierPinService } from './cashier-pin.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganizationsModule } from '../organizations/organizations.module';

@Module({
  imports: [SupabaseModule, NotificationsModule, OrganizationsModule],
  controllers: [OrganizationStaffController, CashierPinController],
  providers: [OrganizationStaffService, CashierPinService],
  exports: [OrganizationStaffService, CashierPinService],
})
export class OrganizationStaffModule {}
