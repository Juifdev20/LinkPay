import { Module } from '@nestjs/common';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';
import { WalletPinService } from './wallet-pin.service';
import { WalletLimitsService } from './wallet-limits.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [SupabaseModule, PaymentsModule, NotificationsModule, AuditModule],
  controllers: [WalletsController],
  providers: [WalletsService, WalletPinService, WalletLimitsService],
  exports: [WalletsService, WalletPinService, WalletLimitsService],
})
export class WalletsModule {}
