import { Module } from '@nestjs/common';
import { StockController, OrganizationStockController } from './stock.controller';
import { StockService } from './stock.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [SupabaseModule, OrganizationsModule, NotificationsModule, AuditModule],
  controllers: [StockController, OrganizationStockController],
  providers: [StockService],
  exports: [StockService],
})
export class StockModule {}
