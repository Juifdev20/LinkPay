import { Module } from '@nestjs/common';
import { OrganizationStaffController } from './organization-staff.controller';
import { OrganizationStaffService } from './organization-staff.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganizationsModule } from '../organizations/organizations.module';

@Module({
  imports: [SupabaseModule, NotificationsModule, OrganizationsModule],
  controllers: [OrganizationStaffController],
  providers: [OrganizationStaffService],
  exports: [OrganizationStaffService],
})
export class OrganizationStaffModule {}
