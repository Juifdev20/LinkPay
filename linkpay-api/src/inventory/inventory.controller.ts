import { Controller, Get, Post, Patch, Body, Param, Query, Headers, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsArray, Min, ValidateNested, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { InventoryService } from './inventory.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

class CreateCountDto {
  @ApiPropertyOptional({ description: 'Catégorie/rayon à inventorier — omis = inventaire total' })
  @IsOptional()
  @IsString()
  scope_category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

class CountedLineDto {
  @ApiProperty()
  @IsString()
  line_id!: string;

  @ApiProperty({ example: 12 })
  @IsNumber()
  @Min(0)
  counted_qty!: number;
}

class SaveLinesDto {
  @ApiProperty({ type: [CountedLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CountedLineDto)
  lines!: CountedLineDto[];
}

// Stock takes are stock-management work — same roles as the stock module
// (owner/enterprise, magasinier, platform admin).
@ApiTags('Inventory')
@ApiBearerAuth()
@Controller('merchants/:id/inventory-counts')
@Roles('enterprise', 'magasinier', 'admin', 'super_admin')
@UseGuards(RolesGuard)
export class InventoryController {
  constructor(private inventoryService: InventoryService) {}

  @Post()
  @ApiOperation({ summary: 'Start a stock take — total or scoped to one category (inventaire tournant)' })
  async createCount(
    @Param('id') merchantId: string,
    @Body() dto: CreateCountDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.inventoryService.createCount(merchantId, callerId, callerRole, callerOrgId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List past and in-progress stock takes' })
  async listCounts(
    @Param('id') merchantId: string,
    @Query('status') status: string | undefined,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.inventoryService.listCounts(merchantId, callerId, callerRole, callerOrgId, {
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get(':countId')
  @ApiOperation({ summary: 'Stock-take detail — lines + démarque report (variances valued at sale price)' })
  async getCount(
    @Param('id') merchantId: string,
    @Param('countId') countId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.inventoryService.getCount(merchantId, countId, callerId, callerRole, callerOrgId);
  }

  @Patch(':countId/lines')
  @ApiOperation({ summary: 'Save counted quantities (bulk, partial saves allowed)' })
  async saveLines(
    @Param('id') merchantId: string,
    @Param('countId') countId: string,
    @Body() dto: SaveLinesDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.inventoryService.saveLines(merchantId, countId, callerId, callerRole, callerOrgId, dto.lines);
  }

  @Post(':countId/complete')
  @ApiOperation({ summary: 'Validate the count (needs the stock password, x-stock-password header) — applies stock adjustments for variances and produces the démarque report' })
  async complete(
    @Param('id') merchantId: string,
    @Param('countId') countId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @Headers('x-stock-password') stockPassword: string | undefined,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.inventoryService.complete(merchantId, countId, callerId, callerRole, callerOrgId, stockPassword);
  }

  @Post(':countId/cancel')
  @ApiOperation({ summary: 'Cancel an in-progress stock take without adjusting anything' })
  async cancel(
    @Param('id') merchantId: string,
    @Param('countId') countId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.inventoryService.cancel(merchantId, countId, callerId, callerRole, callerOrgId);
  }
}
