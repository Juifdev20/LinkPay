import { Controller, Get, Put, Param, Body, Query, UseGuards, ForbiddenException } from '@nestjs/common';
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

/**
 * Merchants are now paid straight into their ScanLinkPay wallet (see
 * MerchantWalletCreditService), so there is no "request a settlement" and no
 * settlement balance any more. What remains here is the history of the
 * settlements created before that change, and the admin's tools to finish
 * the ones still in flight.
 */
@ApiTags('Settlements')
@ApiBearerAuth()
@Controller('settlements')
export class SettlementsController {
  constructor(private settlementsService: SettlementsService) {}

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
