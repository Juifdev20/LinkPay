import { Module } from '@nestjs/common';
import { PaymentRequestsController } from './payment-requests.controller';
import { PaymentRequestsService } from './payment-requests.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { CommissionsModule } from '../commissions/commissions.module';

@Module({
  imports: [SupabaseModule, CommissionsModule],
  controllers: [PaymentRequestsController],
  providers: [PaymentRequestsService],
  exports: [PaymentRequestsService],
})
export class PaymentRequestsModule {}
