import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsArray, ArrayMinSize, ValidateNested, IsInt, IsString, Min, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { SalesService } from './sales.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

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

class ArchiveSaleDto {
  @ApiProperty({ description: 'Mot de passe de gestion de cette entreprise' })
  @IsString()
  stock_password!: string;
}

@ApiTags('Sales')
@ApiBearerAuth()
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
}
