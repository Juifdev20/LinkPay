import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [SupabaseModule, PaymentsModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
