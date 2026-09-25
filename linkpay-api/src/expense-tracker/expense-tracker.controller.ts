import { Controller, Get, Post, Put, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsIn, IsString, IsInt, Min, MaxLength, Length } from 'class-validator';
import { ExpenseTrackerService } from './expense-tracker.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

// Every non-enterprise role, spelled out explicitly — this project has no
// deny-list mechanism (RolesGuard is a pure allow-list), so every
// controller enumerates its own allowed roles. Deliberately excludes
// 'enterprise': organizations get their own separate expense feature.
const NON_ENTERPRISE_ROLES = ['client', 'merchant', 'cashier', 'admin', 'super_admin'];

class AddExpenseEntryDto {
  @ApiProperty({ example: 5000, description: 'Amount in cents' })
  @IsNumber()
  @Min(1)
  amount_cents!: number;

  @ApiPropertyOptional({ default: 'CDF', enum: ['CDF', 'USD'] })
  @IsOptional()
  @IsIn(['CDF', 'USD'])
  currency?: string;

  @ApiPropertyOptional({ example: 'Transport' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

class ActivateProWalletDto {
  @ApiProperty()
  @IsString()
  @Length(4, 4)
  pin!: string;
}

class UpdateExpenseTrackerSettingsDto {
  @ApiPropertyOptional({ description: 'Number of free reports a trial user may create-and-close' })
  @IsOptional()
  @IsInt()
  @Min(0)
  trial_report_limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  monthly_price_cents?: number;

  @ApiPropertyOptional({ enum: ['CDF', 'USD'] })
  @IsOptional()
  @IsIn(['CDF', 'USD'])
  monthly_price_currency?: string;
}

@ApiTags('Expense Tracker')
@ApiBearerAuth()
@Controller('expense-tracker')
@Roles(...NON_ENTERPRISE_ROLES)
@UseGuards(RolesGuard)
export class ExpenseTrackerController {
  constructor(private expenseTrackerService: ExpenseTrackerService) {}

  @Get('status')
  @ApiOperation({ summary: "Caller's plan/trial/Pro status and current pricing — drives the plan-selection screen and paywall UI" })
  async getStatus(@CurrentUser('id') userId: string) {
    return this.expenseTrackerService.getStatus(userId);
  }

  @Post('plan/trial')
  @ApiOperation({ summary: 'First-time choice: start the free, count-limited trial (choosing "unlimited" instead just means paying via the pro/activate routes below)' })
  async choosePlan(@CurrentUser('id') userId: string) {
    return this.expenseTrackerService.choosePlan(userId);
  }

  @Get('reports')
  @ApiOperation({ summary: "List the caller's expense reports, newest first" })
  async listReports(@CurrentUser('id') userId: string) {
    return this.expenseTrackerService.listReports(userId);
  }

  @Get('reports/current')
  @ApiOperation({ summary: 'The currently open report, if any — does not create one' })
  async getCurrentReport(@CurrentUser('id') userId: string) {
    return this.expenseTrackerService.getCurrentReport(userId);
  }

  @Post('reports')
  @ApiOperation({ summary: 'Start a new report (or return the already-open one) — blocked once the trial limit is reached or Pro has expired' })
  async createReport(@CurrentUser('id') userId: string) {
    return this.expenseTrackerService.createReport(userId);
  }

  @Get('reports/:id')
  @ApiOperation({ summary: 'Get one expense report with its entries and per-currency totals' })
  async getReport(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.expenseTrackerService.getReport(userId, id);
  }

  @Get('reports/:id/pdf-data')
  @ApiOperation({ summary: 'Same payload as GET reports/:id — always accessible, even read-only, feeds the client-side PDF generator' })
  async getPdfData(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.expenseTrackerService.getPdfData(userId, id);
  }

  @Post('reports/:id/entries')
  @ApiOperation({ summary: 'Add an expense entry to an open report — blocked if the report is closed or the trial/Pro period has expired' })
  async addEntry(@CurrentUser('id') userId: string, @Param('id') id: string, @Body() dto: AddExpenseEntryDto) {
    return this.expenseTrackerService.addEntry(userId, id, dto);
  }

  @Post('reports/:id/close')
  @ApiOperation({ summary: 'Close a report — locks it permanently and counts against the trial limit if on the trial plan' })
  async closeReport(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.expenseTrackerService.closeReport(userId, id);
  }

  @Post('pro/activate')
  @ApiOperation({ summary: 'Activate/renew unlimited access by debiting the wallet — PIN required, extends from current expiry if still active' })
  async activateProViaWallet(@CurrentUser('id') userId: string, @Body() dto: ActivateProWalletDto) {
    return this.expenseTrackerService.activateProViaWallet(userId, dto.pin);
  }

  @Post('pro/activate/cinetpay')
  @ApiOperation({ summary: 'Activate/renew unlimited access via CinetPay — returns a checkout URL (or completes immediately with the mock PSP)' })
  async activateProViaCinetPay(@CurrentUser('id') userId: string) {
    return this.expenseTrackerService.activateProViaCinetPay(userId);
  }

  @Get('pro/payments/:reference/status')
  @ApiOperation({ summary: 'Poll a CinetPay Pro-activation payment by reference' })
  async getProPaymentStatus(@CurrentUser('id') userId: string, @Param('reference') reference: string) {
    return this.expenseTrackerService.getProPaymentStatus(userId, reference);
  }

  @Get('admin/settings')
  @Roles('super_admin')
  @ApiOperation({ summary: 'Current trial report limit / monthly price (super_admin only)' })
  async getAdminSettings() {
    return this.expenseTrackerService.getAdminSettings();
  }

  @Put('admin/settings')
  @Roles('super_admin')
  @ApiOperation({ summary: 'Update trial report limit / monthly price (super_admin only) — never affects already-chosen trials' })
  async updateAdminSettings(@CurrentUser('id') adminUserId: string, @Body() dto: UpdateExpenseTrackerSettingsDto) {
    return this.expenseTrackerService.updateAdminSettings(adminUserId, dto);
  }
}
