import { Controller, Get, Post, Put, Param, Body, Query, UseGuards, ForbiddenException, BadRequestException } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SettlementsService } from './settlements.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { toPage, toLimit } from '../common/utils/pagination';

class UpdateSettlementStatusDto {
  @ApiProperty({ enum: ['PROCESSING', 'COMPLETED', 'FAILED'] })
  @IsIn(['PROCESSING', 'COMPLETED', 'FAILED'])
  status!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

@ApiTags('Settlements')
@ApiBearerAuth()
@Controller('settlements')
export class SettlementsController {
  constructor(private settlementsService: SettlementsService) {}

  // Store owner only (an enterprise owner acting as one of their stores
  // counts as 'enterprise' in RolesGuard). Cashiers can't request payouts.
  @Post()
  @Roles('merchant', 'enterprise')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Request a settlement of all unsettled transactions for the current store' })
  async createSettlement(@CurrentUser('merchant_id') merchantId: string | undefined) {
    if (!merchantId) {
      throw new BadRequestException('No merchant account associated');
    }
    return this.settlementsService.createSettlement(merchantId);
  }

  @Get()
  @ApiOperation({ summary: 'List settlements' })
  async list(
    @CurrentUser('role') role: string,
    @CurrentUser('merchant_id') merchantId: string | undefined,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const filters = {
      status,
      page: toPage(page),
      limit: toLimit(limit),
    };

    if (role === 'admin' || role === 'super_admin') {
      return this.settlementsService.getAllSettlements(filters);
    }
    if (merchantId) {
      return this.settlementsService.getMerchantSettlements(merchantId, filters);
    }
    return { data: [], total: 0, page: 1, limit: 20 };
  }

  @Get('balance')
  @ApiOperation({ summary: 'Get current merchant settlement balance' })
  async getBalance(@CurrentUser('merchant_id') merchantId: string | undefined) {
    if (!merchantId) {
      return { available: { CDF: 0, USD: 0 }, pending: { CDF: 0, USD: 0 } };
    }
    return this.settlementsService.getMerchantBalance(merchantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get settlement by ID (owner merchant or admin only)' })
  async getById(
    @Param('id') id: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('merchant_id') callerMerchantId: string | undefined,
  ) {
    const settlement = await this.settlementsService.getSettlementById(id);
    if (callerRole !== 'admin' && callerRole !== 'super_admin' && settlement.merchant_id !== callerMerchantId) {
      throw new ForbiddenException('You do not manage this settlement');
    }
    return settlement;
  }

  @Put(':id/status')
  @Roles('admin', 'super_admin')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Update settlement status (Admin)' })
  async updateStatus(
    @Param('id') id: string,
    @Body() body: UpdateSettlementStatusDto,
  ) {
    return this.settlementsService.updateSettlementStatus(id, body.status, body.notes);
  }
}
