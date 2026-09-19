import { Module } from '@nestjs/common';
import { TontinesController } from './tontines.controller';
import { TontinesService } from './tontines.service';
import { TontinesCronService } from './tontines-cron.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { WalletsModule } from '../wallets/wallets.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [SupabaseModule, WalletsModule, NotificationsModule],
  controllers: [TontinesController],
  providers: [TontinesService, TontinesCronService],
  exports: [TontinesService],
})
export class TontinesModule {}
