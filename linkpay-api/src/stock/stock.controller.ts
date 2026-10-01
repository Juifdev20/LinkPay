import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsIn, MaxLength, Min } from 'class-validator';
import { StockService } from './stock.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

const CONDITIONS = ['neuf', 'occasion', 'reconditionne'];
const MOVEMENT_TYPES = ['in', 'out', 'adjustment'];

class CreateStockItemDto {
  @ApiProperty({ example: 'Samsung Galaxy A54' })
  @IsString()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ example: 'Samsung' })
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiPropertyOptional({ example: 'Galaxy A54' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ example: '359123456789012' })
  @IsOptional()
  @IsString()
  serial_number?: string;

  @ApiPropertyOptional({ enum: CONDITIONS })
  @IsOptional()
  @IsIn(CONDITIONS)
  condition?: string;

  @ApiPropertyOptional({ example: 6 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  warranty_months?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;

  @ApiPropertyOptional({ example: 45000000, description: 'Prix de vente en centimes' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unit_price_cents?: number;

  @ApiPropertyOptional({ example: 35000000, description: "Prix d'achat en centimes" })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cost_price_cents?: number;

  @ApiPropertyOptional({ default: 'CDF', enum: ['CDF', 'USD'] })
  @IsOptional()
  @IsIn(['CDF', 'USD'])
  currency?: string;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  low_stock_threshold?: number;
}

class UpdateStockItemDto extends CreateStockItemDto {}

class CreateMovementDto {
  @ApiProperty({ enum: MOVEMENT_TYPES })
  @IsIn(MOVEMENT_TYPES)
  type!: 'in' | 'out' | 'adjustment';

  @ApiProperty({ example: 10, description: 'Positif pour un réapprovisionnement, négatif pour une perte/casse' })
  @IsNumber()
  quantity_delta!: number;

  @ApiPropertyOptional({ example: 'Réapprovisionnement fournisseur' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

@ApiTags('Stock')
@ApiBearerAuth()
@Controller('merchants')
export class StockController {
  constructor(private stockService: StockService) {}

  @Post(':id/stock-items')
  @ApiOperation({ summary: 'Create a stock item for this store (owner or magasinier)' })
  async createItem(
    @Param('id') merchantId: string,
    @Body() dto: CreateStockItemDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.stockService.createItem(merchantId, callerId, callerRole, callerOrgId, dto);
  }

  @Get(':id/stock-items')
  @ApiOperation({ summary: 'List stock items for this store (owner or magasinier)' })
  async listItems(
    @Param('id') merchantId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.stockService.listItems(merchantId, callerId, callerRole, callerOrgId);
  }

  @Put(':id/stock-items/:itemId')
  @ApiOperation({ summary: 'Update a stock item (owner or magasinier) — quantity is read-only here, use movements' })
  async updateItem(
    @Param('id') merchantId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateStockItemDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.stockService.updateItem(merchantId, itemId, callerId, callerRole, callerOrgId, dto);
  }

  @Delete(':id/stock-items/:itemId')
  @ApiOperation({ summary: 'Delete a stock item (owner or magasinier)' })
  async deleteItem(
    @Param('id') merchantId: string,
    @Param('itemId') itemId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.stockService.deleteItem(merchantId, itemId, callerId, callerRole, callerOrgId);
  }

  @Post(':id/stock-items/:itemId/movements')
  @ApiOperation({ summary: 'Record a restock, loss or correction for a stock item (owner or magasinier)' })
  async createMovement(
    @Param('id') merchantId: string,
    @Param('itemId') itemId: string,
    @Body() dto: CreateMovementDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.stockService.createMovement(merchantId, itemId, callerId, callerRole, callerOrgId, dto);
  }

  @Get(':id/stock-items/:itemId/movements')
  @ApiOperation({ summary: 'List the movement history for a stock item (owner or magasinier)' })
  async listMovements(
    @Param('id') merchantId: string,
    @Param('itemId') itemId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.stockService.listMovements(merchantId, itemId, callerId, callerRole, callerOrgId);
  }
}

@ApiTags('Stock')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationStockController {
  constructor(private stockService: StockService) {}

  @Get(':id/stock-items')
  @ApiOperation({ summary: "List stock across every store of this organization (owner or magasinier) — the 'sees everything' admin view" })
  async getOrgStockItems(
    @Param('id') orgId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.stockService.getOrgStockItems(orgId, callerId, callerRole, callerOrgId);
  }

  @Get(':id/stock-summary')
  @ApiOperation({ summary: 'Aggregated stock stats across every store of this organization (owner or magasinier)' })
  async getOrgStockSummary(
    @Param('id') orgId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.stockService.getOrgStockSummary(orgId, callerId, callerRole, callerOrgId);
  }
}
