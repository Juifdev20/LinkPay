import { Module } from '@nestjs/common';
import { ExpenseTrackerController } from './expense-tracker.controller';
import { ExpenseTrackerService } from './expense-tracker.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { WalletPinService } from '../wallets/wallet-pin.service';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [SupabaseModule, PaymentsModule, NotificationsModule],
  controllers: [ExpenseTrackerController],
  // WalletPinService is also provided by WalletsModule — redeclared here
  // rather than importing WalletsModule, same pattern already used by
  // SavingsModule/PaymentsModule, to avoid a circular module dependency.
  // Stateless Supabase wrapper, a second instance is harmless.
  providers: [ExpenseTrackerService, WalletPinService],
  exports: [ExpenseTrackerService],
})
export class ExpenseTrackerModule {}
