import { Module } from '@nestjs/common';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [SupabaseModule, PaymentsModule, NotificationsModule],
  controllers: [WalletsController],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
