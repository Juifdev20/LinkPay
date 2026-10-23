import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportsCronService } from './reports-cron.service';
import { RestockService } from './restock.service';
import { RestockController } from './restock.controller';
import { SellerReportService } from './seller-report.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { StockModule } from '../stock/stock.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [SupabaseModule, StockModule, OrganizationsModule, NotificationsModule],
  controllers: [ReportsController, RestockController],
  providers: [ReportsService, ReportsCronService, RestockService, SellerReportService],
  exports: [ReportsService],
})
export class ReportsModule {}
