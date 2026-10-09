import { Global, Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';
import { WalletsModule } from '../wallets/wallets.module';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionGuard } from './subscription.guard';
import { SubscriptionsController, SubscriptionsAdminController } from './subscriptions.controller';

/** Global so any controller can use @RequireSubscription without importing this module. */
@Global()
@Module({
  imports: [SupabaseModule, NotificationsModule, AuditModule, WalletsModule],
  controllers: [SubscriptionsController, SubscriptionsAdminController],
  providers: [SubscriptionsService, SubscriptionGuard],
  exports: [SubscriptionsService, SubscriptionGuard],
})
export class SubscriptionsModule {}
