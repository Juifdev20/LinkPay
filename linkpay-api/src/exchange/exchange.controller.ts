import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { OtpStepUpGuard, RequireOtp } from '../security/otp-step-up.guard';
import { ExchangeService } from './exchange.service';
import { effectiveRole } from './exchange.rules';

const MAX_CENTS = 1_000_000_000_000;

class QuoteDto {
  @ApiProperty({ enum: ['CDF', 'USD'] })
  @IsIn(['CDF', 'USD'])
  from_currency!: 'CDF' | 'USD';

  @ApiProperty({ enum: ['CDF', 'USD'] })
  @IsIn(['CDF', 'USD'])
  to_currency!: 'CDF' | 'USD';

  @ApiProperty({ example: 10000, description: 'Amount GIVEN, in cents of from_currency (10000 = 100.00 $)' })
  @IsInt()
  @Min(1)
  @Max(MAX_CENTS)
  amount_cents!: number;
}

class ExecuteDto {
  @ApiProperty({ description: 'The quote the person has just seen and accepted' })
  @IsUUID()
  quote_id!: string;

  @ApiProperty({ description: 'Transaction PIN' })
  @IsString()
  @Length(4, 6)
  pin!: string;
}

/** The Bureau d'échange as a client sees it: clients, shops and business owners only (the service re-checks the role). */
@ApiTags("Bureau d'échange")
@ApiBearerAuth()
@Controller('exchange')
export class ExchangeController {
  constructor(private exchange: ExchangeService) {}

  @Get()
  @ApiOperation({ summary: "State of the Bureau d'échange for the caller: available, rates, limits, validation status" })
  state(@CurrentUser() user: any) {
    return this.exchange.getState(user.id, effectiveRole(user));
  }

  @Post('verification')
  @ApiOperation({ summary: "Ask the team to validate the account for the Bureau d'échange" })
  requestVerification(@CurrentUser() user: any) {
    return this.exchange.requestVerification(user.id, effectiveRole(user));
  }

  @Post('quotes')
  @ApiOperation({ summary: 'Fix the rate for 60 seconds and say what would be received' })
  quote(@CurrentUser() user: any, @Body() dto: QuoteDto) {
    return this.exchange.createQuote(user.id, effectiveRole(user), dto);
  }

  // No device-integrity check: the money never leaves the wallet (that rule is for transfers and withdrawals).
  @Post()
  @ApiOperation({ summary: 'Exchange one currency for the other, at the rate of an accepted quote (PIN required)' })
  execute(@CurrentUser() user: any, @Body() dto: ExecuteDto, @Headers('idempotency-key') idempotencyKey: string) {
    if (!idempotencyKey) throw new BadRequestException('Idempotency-Key header is required');
    return this.exchange.execute(user.id, effectiveRole(user), dto, idempotencyKey);
  }
}

// ----------------------------------------------------------------------------
// Administration
// ----------------------------------------------------------------------------

class RatesDto {
  @ApiProperty({ example: 2820, description: "Francs given to a client for 1 $ (the client gives dollars): our BUYING price" })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(999999)
  buy_rate!: number;

  @ApiProperty({ example: 2880, description: 'Francs a client pays for 1 $ (the client gives francs): our SELLING price' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(999999)
  sell_rate!: number;

  @ApiPropertyOptional({ nullable: true, example: 2850, description: 'The market rate, to measure the gain (between buy and sell). Empty = the middle of both.' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(999999)
  market_rate?: number | null;

  @ApiPropertyOptional({ description: 'Second confirmation when the rates are very different from the previous ones' })
  @IsOptional()
  @IsBoolean()
  confirm_large_change?: boolean;
}

class EnabledDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}

class LimitsDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(0) @Max(MAX_CENTS)
  min_cents?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(1) @Max(MAX_CENTS)
  max_cents?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(1) @Max(MAX_CENTS)
  daily_max_cents?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(1) @Max(MAX_CENTS)
  monthly_max_cents?: number | null;
}

class ReasonDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

/** Rates, limits, gains and the validation of accounts, for the ScanLinkPay team. */
@ApiTags("Bureau d'échange (admin)")
@ApiBearerAuth()
@Controller('admin/exchange')
@UseGuards(RolesGuard)
export class ExchangeAdminController {
  constructor(private exchange: ExchangeService) {}

  @Get('overview')
  @Roles('super_admin')
  overview() {
    return this.exchange.adminOverview();
  }

  @Put('rates')
  @Roles('super_admin')
  @UseGuards(OtpStepUpGuard)
  @RequireOtp()
  @ApiOperation({ summary: "Set today's buying and selling prices (super admin, authenticator code)" })
  setRates(@CurrentUser('id') adminId: string, @Body() dto: RatesDto) {
    return this.exchange.setRates(adminId, dto);
  }

  @Put('service')
  @Roles('super_admin')
  @UseGuards(OtpStepUpGuard)
  @RequireOtp()
  @ApiOperation({ summary: "Open or close the Bureau d'échange (super admin, authenticator code)" })
  setEnabled(@CurrentUser('id') adminId: string, @Body() dto: EnabledDto) {
    return this.exchange.setEnabled(adminId, dto.enabled);
  }

  @Put('limits/:currency')
  @Roles('super_admin')
  @UseGuards(OtpStepUpGuard)
  @RequireOtp()
  @ApiOperation({ summary: 'Set the limits of one currency (the currency GIVEN by the client)' })
  setLimits(@CurrentUser('id') adminId: string, @Param('currency') currency: string, @Body() dto: LimitsDto) {
    return this.exchange.setLimits(adminId, currency, dto);
  }

  @Get('verifications')
  @Roles('admin', 'super_admin')
  @ApiOperation({ summary: 'Accounts that asked to use the Bureau d\'échange (filter by status)' })
  verifications(@Query('status') status?: string) {
    return this.exchange.listVerifications(['pending', 'approved', 'rejected', 'revoked'].includes(status || '') ? status : undefined);
  }

  @Post('verifications/:userId/approve')
  @Roles('admin', 'super_admin')
  approve(@CurrentUser('id') adminId: string, @Param('userId', new ParseUUIDPipe()) userId: string) {
    return this.exchange.approve(adminId, userId);
  }

  @Post('verifications/:userId/reject')
  @Roles('admin', 'super_admin')
  reject(@CurrentUser('id') adminId: string, @Param('userId', new ParseUUIDPipe()) userId: string, @Body() dto: ReasonDto) {
    return this.exchange.reject(adminId, userId, dto.reason || '');
  }

  @Post('verifications/:userId/revoke')
  @Roles('admin', 'super_admin')
  revoke(@CurrentUser('id') adminId: string, @Param('userId', new ParseUUIDPipe()) userId: string, @Body() dto: ReasonDto) {
    return this.exchange.revoke(adminId, userId, dto.reason);
  }
}
