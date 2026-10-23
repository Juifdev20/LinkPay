import { Module } from '@nestjs/common';
import { StockController, OrganizationStockController, SuppliersController } from './stock.controller';
import { SuppliersService } from './suppliers.service';
import { StockService } from './stock.service';
import { StockPasswordService } from './stock-password.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [SupabaseModule, OrganizationsModule, NotificationsModule, AuditModule],
  controllers: [StockController, OrganizationStockController, SuppliersController],
  providers: [StockService, StockPasswordService, SuppliersService],
  exports: [StockService, StockPasswordService, SuppliersService],
})
export class StockModule {}
