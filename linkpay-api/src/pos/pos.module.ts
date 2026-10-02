import { Module } from '@nestjs/common';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { StockModule } from '../stock/stock.module';
import { PaymentRequestsModule } from '../payment-requests/payment-requests.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [SupabaseModule, StockModule, PaymentRequestsModule, AuditModule],
  controllers: [PosController],
  providers: [PosService],
  exports: [PosService],
})
export class PosModule {}
