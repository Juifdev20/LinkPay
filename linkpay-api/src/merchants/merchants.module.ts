import { Module } from '@nestjs/common';
import { MerchantsController } from './merchants.controller';
import { MerchantsService } from './merchants.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MerchantInvitationsService } from './merchant-invitations.service';
import { MerchantInvitationsController } from './merchant-invitations.controller';

@Module({
  imports: [SupabaseModule, AuthModule, NotificationsModule],
  controllers: [MerchantsController, MerchantInvitationsController],
  providers: [MerchantsService, MerchantInvitationsService],
  exports: [MerchantsService],
})
export class MerchantsModule {}
