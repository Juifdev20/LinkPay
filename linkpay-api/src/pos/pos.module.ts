import { Module } from '@nestjs/common';
import { PosController } from './pos.controller';
import { PosStatsController } from './pos-stats.controller';
import { PosService } from './pos.service';
import { PosStatsService } from './pos-stats.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { StockModule } from '../stock/stock.module';
import { PaymentRequestsModule } from '../payment-requests/payment-requests.module';
import { AuditModule } from '../audit/audit.module';
import { OrganizationStaffModule } from '../organization-staff/organization-staff.module';

@Module({
  imports: [SupabaseModule, StockModule, PaymentRequestsModule, AuditModule, OrganizationStaffModule],
  controllers: [PosController, PosStatsController],
  providers: [PosService, PosStatsService],
  exports: [PosService],
})
export class PosModule {}
