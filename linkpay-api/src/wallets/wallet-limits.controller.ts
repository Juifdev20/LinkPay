import { Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { WalletLimitsService } from './wallet-limits.service';
import { OtpStepUpGuard, RequireOtp } from '../security/otp-step-up.guard';
import { SecurityAlertsService } from '../security/security-alerts.service';

/** Highest fee an admin can set — a typo like 5 (meaning 5%, read as 500%) must not go through. */
const MAX_FEE_FRACTION = 0.2;
const MAX_CENTS = 1_000_000_000_000;

export class UpdateWalletLimitDto {
  @ApiPropertyOptional({ example: 0.01, description: 'Fee as a fraction: 0.01 = 1 %' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(MAX_FEE_FRACTION)
  fee_percent?: number;

  @ApiPropertyOptional({ description: 'Fixed fee, in cents' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_CENTS)
  fee_fixed_cents?: number;

  @ApiPropertyOptional({ description: 'Minimum per operation, in cents' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_CENTS)
  min_cents?: number;

  @ApiPropertyOptional({ nullable: true, description: 'Maximum per operation, in cents — null removes the cap' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_CENTS)
  max_cents?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Daily cap, in cents — null removes the cap' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_CENTS)
  daily_max_cents?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Monthly cap, in cents — null removes the cap' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_CENTS)
  monthly_max_cents?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

/** Fees and limits of wallet operations (transfer, withdrawal, wallet payment), editable by the super admin. */
@ApiTags('Wallet limits')
@ApiBearerAuth()
@Controller('wallet-limits')
@UseGuards(RolesGuard)
export class WalletLimitsController {
  constructor(
    private limits: WalletLimitsService,
    private audit: AuditService,
    private alerts: SecurityAlertsService,
  ) {}

  @Get()
  @Roles('admin', 'super_admin')
  @ApiOperation({ summary: 'List the fee and limit rules of wallet operations' })
  list() {
    return this.limits.listRules();
  }

  @Put(':id')
  @Roles('super_admin')
  @UseGuards(OtpStepUpGuard)
  @RequireOtp()
  @ApiOperation({ summary: 'Change the fee or limits of one rule (super admin only)' })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateWalletLimitDto,
    @CurrentUser('id') adminId: string,
  ) {
    const { before, after } = await this.limits.updateRule(id, dto);
    await this.audit.log({
      user_id: adminId,
      action: 'wallet_limit_updated',
      entity_type: 'wallet_limit',
      entity_id: id,
      changes: { op_type: before.op_type, currency: before.currency, before, after },
    });
    await this.alerts.alert({
      severity: 'warning',
      title: 'Frais ou limites de portefeuille modifiés',
      body: `Règle ${before.op_type} ${before.currency} modifiée par ${adminId}.`,
      data: { before, after },
    });
    return after;
  }
}
