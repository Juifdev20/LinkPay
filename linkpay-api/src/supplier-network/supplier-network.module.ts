import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';
import { WalletsModule } from '../wallets/wallets.module';
import { StockModule } from '../stock/stock.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { SupplierPlanService } from './supplier-plan.service';
import { SupplierNetworkService } from './supplier-network.service';
import { SupplierOrdersService } from './supplier-orders.service';
import { SupplierNetworkController, SupplierPlanAdminController } from './supplier-network.controller';

/**
 * The supplier network (DECISIONS.md 23/10, phase C). PaymentsService reaches SupplierOrdersService through the
 * ModuleRef (no import: WalletsModule already imports PaymentsModule, an import here would close a loop).
 */
@Module({
  imports: [SupabaseModule, NotificationsModule, AuditModule, WalletsModule, StockModule, OrganizationsModule],
  controllers: [SupplierNetworkController, SupplierPlanAdminController],
  providers: [SupplierPlanService, SupplierNetworkService, SupplierOrdersService],
  exports: [SupplierOrdersService],
})
export class SupplierNetworkModule {}
