import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WalletsModule } from '../wallets/wallets.module';
import { ExchangeService } from './exchange.service';
import { ExchangeController, ExchangeAdminController } from './exchange.controller';

@Module({
  imports: [SupabaseModule, AuditModule, NotificationsModule, WalletsModule],
  controllers: [ExchangeController, ExchangeAdminController],
  providers: [ExchangeService],
  exports: [ExchangeService],
})
export class ExchangeModule {}
