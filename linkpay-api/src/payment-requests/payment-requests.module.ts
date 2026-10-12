import { Module } from '@nestjs/common';
import { PaymentRequestsController } from './payment-requests.controller';
import { PaymentRequestsService } from './payment-requests.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { CommissionsModule } from '../commissions/commissions.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { MerchantsModule } from '../merchants/merchants.module';

@Module({
  imports: [SupabaseModule, CommissionsModule, OrganizationsModule, MerchantsModule],
  controllers: [PaymentRequestsController],
  providers: [PaymentRequestsService],
  exports: [PaymentRequestsService],
})
export class PaymentRequestsModule {}
