import { Controller, Get, Param, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PosStatsService } from './pos-stats.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

function requireRange(from?: string, to?: string) {
  if (!from || !to) throw new BadRequestException('Les paramètres from/to (ISO dates) sont requis.');
  return { from, to };
}

@ApiTags('POS Stats')
@ApiBearerAuth()
@Controller('merchants/:id/pos/stats')
@Roles('enterprise', 'comptable', 'admin', 'super_admin')
@UseGuards(RolesGuard)
export class PosStatsController {
  constructor(private posStatsService: PosStatsService) {}

  @Get('summary')
  @ApiOperation({ summary: 'CA, tickets, panier moyen, TVA et marge sur une période' })
  async summary(
    @Param('id') merchantId: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('currency') currency: string | undefined,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.posStatsService.getSummary(merchantId, callerId, callerRole, callerOrgId, { ...requireRange(from, to), currency });
  }

  @Get('daily')
  @ApiOperation({ summary: 'Chiffre d\'affaires par jour sur la période' })
  async daily(
    @Param('id') merchantId: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('currency') currency: string | undefined,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.posStatsService.getDaily(merchantId, callerId, callerRole, callerOrgId, { ...requireRange(from, to), currency });
  }

  @Get('top-products')
  @ApiOperation({ summary: 'Palmarès des produits les plus vendus (quantité, CA, marge)' })
  async topProducts(
    @Param('id') merchantId: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('currency') currency: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.posStatsService.getTopProducts(merchantId, callerId, callerRole, callerOrgId, {
      ...requireRange(from, to),
      currency,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('dead-stock')
  @ApiOperation({ summary: 'Produits en rayon sans aucune vente sur la période (rotation lente)' })
  async deadStock(
    @Param('id') merchantId: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('currency') currency: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.posStatsService.getDeadStock(merchantId, callerId, callerRole, callerOrgId, {
      ...requireRange(from, to),
      currency,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
