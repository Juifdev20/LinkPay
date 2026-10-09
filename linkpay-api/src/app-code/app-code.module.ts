import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AppCodeController } from './app-code.controller';
import { AppCodeService } from './app-code.service';

@Module({
  imports: [SupabaseModule, NotificationsModule],
  controllers: [AppCodeController],
  providers: [AppCodeService],
  exports: [AppCodeService],
})
export class AppCodeModule {}
