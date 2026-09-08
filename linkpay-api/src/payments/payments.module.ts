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
import { AuditModule } from '../audit/audit.module';
import { WalletPinService } from '../wallets/wallet-pin.service';
import { WalletLimitsService } from '../wallets/wallet-limits.service';

@Module({
  imports: [
    SupabaseModule,
    PaymentRequestsModule,
    CommissionsModule,
    LedgerModule,
    TransactionsModule,
    NotificationsModule,
    AuditModule,
  ],
  controllers: [PaymentsController],
  // WalletPinService/WalletLimitsService are also provided by WalletsModule
  // (which itself imports PaymentsModule for PspFactory) — redeclared here
  // rather than importing WalletsModule, to avoid a circular module
  // dependency. Both are stateless Supabase wrappers, so a second instance
  // here is harmless.
  providers: [PaymentsService, PspFactory, MockPspAdapter, CinetPayAdapter, WalletPinService, WalletLimitsService],
  exports: [PaymentsService, PspFactory],
})
export class PaymentsModule {}
