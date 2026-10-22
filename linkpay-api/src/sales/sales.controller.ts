import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, ArrayMinSize, ArrayMaxSize, ValidateNested, IsInt, IsOptional, IsString, Min, Max, IsUUID, IsISO8601 } from 'class-validator';
import { Type } from 'class-transformer';
import { SalesService } from './sales.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireSubscription } from '../subscriptions/subscription.guard';

class SaleLineDto {
  @ApiProperty()
  @IsUUID()
  stock_item_id!: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  quantity!: number;
}

class CreateSaleDto {
  @ApiProperty({ type: [SaleLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaleLineDto)
  items!: SaleLineDto[];
}

class OfflineSaleLineDto {
  @ApiProperty()
  @IsUUID()
  stock_item_id!: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  @Max(100000)
  quantity!: number;

  @ApiProperty({ description: "Prix unitaire vu par l'appareil au moment de la vente (centimes)" })
  @IsInt()
  @Min(0)
  unit_price_cents!: number;
}

class OfflineSaleDto {
  @ApiProperty({ description: "Id créé sur l'appareil : la même vente envoyée deux fois est gardée une fois" })
  @IsUUID()
  client_ref!: string;

  @ApiProperty({ description: 'Heure de la vente (7 jours au plus, jamais dans le futur)' })
  @IsISO8601()
  sold_at!: string;

  @ApiProperty({ type: [OfflineSaleLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OfflineSaleLineDto)
  items!: OfflineSaleLineDto[];
}

class ArchiveSaleDto {
  @ApiPropertyOptional({ description: "Mot de passe de gestion — seulement si le patron l'a activé" })
  @IsOptional()
  @IsString()
  stock_password?: string;
}

@ApiTags('Sales')
@ApiBearerAuth()
@RequireSubscription('org')
@Controller('organizations')
export class SalesController {
  constructor(private salesService: SalesService) {}

  @Post(':id/sales')
  @ApiOperation({ summary: 'Create a sale from a cart and open its wallet payment request' })
  async createSale(
    @Param('id') orgId: string,
    @Body() dto: CreateSaleDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('organization_id') callerOrgId?: string,
    @CurrentUser('role') callerRole?: string,
  ) {
    return this.salesService.createSale(orgId, callerId, callerOrgId, dto.items, callerRole);
  }

  @Post(':id/sales/offline')
  @ApiOperation({ summary: 'Record a sale made without network (paid in cash), in one piece and only once' })
  async recordOfflineSale(
    @Param('id') orgId: string,
    @Body() dto: OfflineSaleDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('organization_id') callerOrgId?: string,
    @CurrentUser('role') callerRole?: string,
  ) {
    return this.salesService.recordOfflineSale(orgId, callerId, callerOrgId, dto, callerRole);
  }

  @Get(':id/sales/stats')
  @ApiOperation({ summary: 'Financial dashboard: revenue, margins and top products for paid sales in a period' })
  async getStats(
    @Param('id') orgId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('organization_id') callerOrgId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @CurrentUser('role') callerRole?: string,
  ) {
    return this.salesService.getStats(orgId, callerId, callerOrgId, from, to, callerRole);
  }

  // Declared before ':saleId' so "history" is not read as a sale id.
  @Get(':id/sales/history')
  @ApiOperation({ summary: 'Sales history list (not archived), newest first, optionally date-filtered' })
  async getHistory(
    @Param('id') orgId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('organization_id') callerOrgId?: string,
    @CurrentUser('role') callerRole?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.salesService.getHistory(orgId, callerId, callerOrgId, callerRole, from, to);
  }

  @Post(':id/sales/:saleId/archive')
  @ApiOperation({ summary: 'Archive a sale from the history (requires the management password). The sale data is kept.' })
  async archiveSale(
    @Param('id') orgId: string,
    @Param('saleId') saleId: string,
    @Body() dto: ArchiveSaleDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('organization_id') callerOrgId?: string,
    @CurrentUser('role') callerRole?: string,
  ) {
    return this.salesService.archiveSale(orgId, saleId, callerId, callerOrgId, callerRole, dto.stock_password);
  }

  @Get(':id/sales/:saleId')
  @ApiOperation({ summary: 'Get a sale with its lines and payment link' })
  async getSale(
    @Param('id') orgId: string,
    @Param('saleId') saleId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('organization_id') callerOrgId?: string,
    @CurrentUser('role') callerRole?: string,
  ) {
    return this.salesService.getSale(orgId, saleId, callerId, callerOrgId, callerRole);
  }

  @Post(':id/sales/:saleId/cash')
  @ApiOperation({ summary: 'Mark a sale as paid in cash' })
  async payCash(
    @Param('id') orgId: string,
    @Param('saleId') saleId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('organization_id') callerOrgId?: string,
    @CurrentUser('role') callerRole?: string,
  ) {
    return this.salesService.payCash(orgId, saleId, callerId, callerOrgId, callerRole);
  }

  @Post(':id/sales/:saleId/cancel')
  @ApiOperation({ summary: 'Cancel a sale not paid yet (the customer left) and close its payment QR' })
  async cancelSale(
    @Param('id') orgId: string,
    @Param('saleId') saleId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('organization_id') callerOrgId?: string,
    @CurrentUser('role') callerRole?: string,
  ) {
    return this.salesService.cancelSale(orgId, saleId, callerId, callerOrgId, callerRole);
  }
}
