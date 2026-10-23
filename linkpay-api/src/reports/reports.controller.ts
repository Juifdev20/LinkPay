import { Controller, Get, Param, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService, ReportPeriod } from './reports.service';
import { SellerReportService } from './seller-report.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

/** [from, to) as ISO dates, in one currency (CDF by default). */
function periodOf(from?: string, to?: string, currency?: string): ReportPeriod {
  if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    throw new BadRequestException('Les paramètres from/to (dates ISO) sont requis.');
  }
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), currency: currency === 'USD' ? 'USD' : 'CDF' };
}

// Readable even without an active subscription: a report is how the owner sees what happened.
@ApiTags('Reports')
@ApiBearerAuth()
@Controller()
@Roles('enterprise', 'gerant', 'comptable', 'admin', 'super_admin')
@UseGuards(RolesGuard)
export class ReportsController {
  constructor(private reports: ReportsService, private sellers: SellerReportService) {}

  @Get('merchants/:id/reports')
  @ApiOperation({ summary: "A station's till report over a period: by payment method, by cashier, by day, cash sessions and discrepancies, voids, products, stock to watch" })
  async station(
    @Param('id') merchantId: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('currency') currency: string | undefined,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.reports.stationReport(merchantId, callerId, callerRole, callerOrgId, periodOf(from, to, currency));
  }

  @Get('organizations/:id/reports')
  @ApiOperation({ summary: 'Every station of the business side by side over a period (owner only)' })
  async organization(
    @Param('id') orgId: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('currency') currency: string | undefined,
    @CurrentUser('id') callerId: string,
  ) {
    return this.reports.organizationReport(orgId, callerId, periodOf(from, to, currency));
  }

  @Get('organizations/:id/reports/sellers')
  @ApiOperation({ summary: 'Sales per seller between two dates — till and Ventes together, every sector (owner: all stations or one; manager / accountant: theirs)' })
  async sellerReport(
    @Param('id') orgId: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('merchant_id') merchantId: string | undefined,
    @CurrentUser() caller: any,
  ) {
    const { from: f, to: t } = periodOf(from, to);
    return this.sellers.report(orgId, caller, { from: f, to: t }, merchantId || undefined);
  }
}
