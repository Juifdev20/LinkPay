import { Module } from '@nestjs/common';
import { StockController, OrganizationStockController } from './stock.controller';
import { StockService } from './stock.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [SupabaseModule, OrganizationsModule, NotificationsModule],
  controllers: [StockController, OrganizationStockController],
  providers: [StockService],
  exports: [StockService],
})
export class StockModule {}
