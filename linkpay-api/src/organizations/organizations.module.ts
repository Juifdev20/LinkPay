import { Module } from '@nestjs/common';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { OrgTreasuryService } from './org-treasury.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { AuthModule } from '../auth/auth.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [SupabaseModule, AuthModule, MerchantsModule, NotificationsModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, OrgTreasuryService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
