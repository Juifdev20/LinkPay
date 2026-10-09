import { Module } from '@nestjs/common';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';
import { WalletPinService } from './wallet-pin.service';
import { WalletLimitsService } from './wallet-limits.service';
import { WalletLimitsController } from './wallet-limits.controller';
import { WithdrawalPayoutService } from './withdrawal-payout.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';
import { RiskModule } from '../risk/risk.module';
import { SavingsModule } from '../savings/savings.module';

@Module({
  imports: [SupabaseModule, PaymentsModule, NotificationsModule, AuditModule, SavingsModule, RiskModule],
  controllers: [WalletsController, WalletLimitsController],
  providers: [WalletsService, WalletPinService, WalletLimitsService, WithdrawalPayoutService],
  exports: [WalletsService, WalletPinService, WalletLimitsService],
})
export class WalletsModule {}
