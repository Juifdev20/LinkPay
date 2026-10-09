import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';
import { WalletsModule } from '../wallets/wallets.module';
import { PaymentsModule } from '../payments/payments.module';
import { PaymentRequestsModule } from '../payment-requests/payment-requests.module';
import { CardsService } from './cards.service';
import { CardsController, CardChargesController, CardsAdminController } from './cards.controller';

@Module({
  imports: [SupabaseModule, NotificationsModule, AuditModule, WalletsModule, PaymentsModule, PaymentRequestsModule],
  controllers: [CardsController, CardChargesController, CardsAdminController],
  providers: [CardsService],
  exports: [CardsService],
})
export class CardsModule {}
