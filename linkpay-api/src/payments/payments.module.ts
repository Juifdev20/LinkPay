import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PspFactory } from './psp/psp.factory';
import { MockPspAdapter } from './psp/providers/mock.adapter';
import { CinetPayAdapter } from './psp/providers/cinetpay.adapter';
import { SupabaseModule } from '../supabase/supabase.module';
import { PaymentRequestsModule } from '../payment-requests/payment-requests.module';
import { CommissionsModule } from '../commissions/commissions.module';
import { LedgerModule } from '../ledger/ledger.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    SupabaseModule,
    PaymentRequestsModule,
    CommissionsModule,
    LedgerModule,
    TransactionsModule,
    NotificationsModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, PspFactory, MockPspAdapter, CinetPayAdapter],
  exports: [PaymentsService, PspFactory],
})
export class PaymentsModule {}
