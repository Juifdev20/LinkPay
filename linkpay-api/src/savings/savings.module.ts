import { Module } from '@nestjs/common';
import { SavingsController } from './savings.controller';
import { SavingsService } from './savings.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { WalletPinService } from '../wallets/wallet-pin.service';

@Module({
  imports: [SupabaseModule],
  controllers: [SavingsController],
  // WalletPinService is also provided by WalletsModule and PaymentsModule —
  // redeclared here rather than importing WalletsModule, same established
  // pattern already used by PaymentsModule (see its own module file's
  // comment) to avoid a circular dependency: WalletsModule/PaymentsModule
  // need to import SavingsModule to call maybeRoundUp(). Stateless Supabase
  // wrapper, a third instance is harmless.
  providers: [SavingsService, WalletPinService],
  exports: [SavingsService],
})
export class SavingsModule {}
