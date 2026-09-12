import { Controller, Get, Post, Put, Param, Body, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SettlementsService } from './settlements.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

@ApiTags('Settlements')
@ApiBearerAuth()
@Controller('settlements')
export class SettlementsController {
  constructor(private settlementsService: SettlementsService) {}

  @Post()
  @Roles('merchant', 'admin', 'super_admin')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Create a settlement for current merchant' })
  async createSettlement(
    @CurrentUser('merchant_id') merchantId: string,
    @Body() body: { period_start?: string; period_end?: string },
  ) {
    return this.settlementsService.createSettlement(merchantId, body);
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
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
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
    @Body() body: { status: string; notes?: string },
  ) {
    return this.settlementsService.updateSettlementStatus(id, body.status, body.notes);
  }
}
