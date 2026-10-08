import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { StockModule } from '../stock/stock.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [SupabaseModule, StockModule, AuditModule],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}
