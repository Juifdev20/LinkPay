import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { OtpStepUpGuard, RequireOtp } from '../security/otp-step-up.guard';
import { SecurityAlertsService } from '../security/security-alerts.service';
import { AuditService } from '../audit/audit.service';
import { LicensesService } from './licenses.service';
import { LICENSE_CURRENCIES, LICENSE_MODES, MAX_LICENSE_DAYS } from './license-features';

class QuoteDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  features?: string[];

  @ApiPropertyOptional({ description: 'Buy every feature at once' })
  @IsOptional()
  @IsBoolean()
  all?: boolean;

  @ApiProperty({ minimum: 1, maximum: MAX_LICENSE_DAYS })
  @IsInt()
  @Min(1)
  @Max(MAX_LICENSE_DAYS)
  days!: number;

  @ApiProperty({ enum: LICENSE_CURRENCIES })
  @IsIn([...LICENSE_CURRENCIES])
  currency!: string;
}

class PurchaseDto extends QuoteDto {
  @ApiProperty({ description: 'Transaction PIN of the wallet' })
  @IsString()
  @Matches(/^\d{4,8}$/, { message: 'PIN invalide' })
  pin!: string;
}

/** What the business owner sees and does. */
@ApiTags('Licenses')
@ApiBearerAuth()
@Controller('licenses')
export class LicensesController {
  constructor(private licenses: LicensesService) {}

  @Get('catalog')
  @ApiOperation({ summary: 'Features, price per day and the trial length' })
  catalog() {
    return this.licenses.getCatalog();
  }

  /** Reachable by the owner and by their staff (the screens need to know what is usable), not by plain clients. */
  @Get('organizations/:id')
  @Roles('enterprise', 'comptable', 'caissier', 'magasinier', 'vendeur', 'admin', 'super_admin')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: "Licence status of each feature for this business" })
  async state(@Param('id') id: string, @CurrentUser('organization_id') callerOrgId: string | undefined, @CurrentUser('role') role: string) {
    this.assertSameOrg(id, callerOrgId, role);
    return this.licenses.getState(id);
  }

  @Post('organizations/:id/quote')
  @Roles('enterprise', 'admin', 'super_admin')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Price of a purchase before paying' })
  async quote(@Param('id') id: string, @Body() dto: QuoteDto, @CurrentUser('organization_id') callerOrgId: string | undefined, @CurrentUser('role') role: string) {
    this.assertSameOrg(id, callerOrgId, role);
    return this.licenses.quote(dto);
  }

  @Post('organizations/:id/purchase')
  @Roles('enterprise')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: "Buy (or extend) licences from the owner's wallet. Header Idempotency-Key required." })
  async purchase(
    @Param('id') id: string,
    @Body() dto: PurchaseDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser('id') userId: string,
  ) {
    if (!idempotencyKey) throw new BadRequestException('Idempotency-Key header is required');
    return this.licenses.purchase(userId, id, dto, idempotencyKey);
  }

  private assertSameOrg(id: string, callerOrgId: string | undefined, role: string) {
    if (role === 'admin' || role === 'super_admin') return;
    if (callerOrgId !== id) throw new ForbiddenException('Accès refusé à cette entreprise');
  }
}

class SettingsDto {
  @IsOptional() @IsInt() @Min(0) @Max(365) trial_days?: number;
  @IsOptional() @IsIn(LICENSE_MODES) trial_end_mode?: 'read_only' | 'blocked';
  @IsOptional() @IsIn(LICENSE_MODES) expiry_mode?: 'read_only' | 'blocked';
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsInt({ each: true }) @Min(1, { each: true }) @Max(90, { each: true }) reminder_days?: number[];
}

class FeatureDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsBoolean() is_active?: boolean;
  /** { CDF: 500, USD: 5 } in cents per day; null removes the price. */
  @IsOptional() prices?: Record<string, number | null>;
}

class BundleDto {
  @IsOptional() prices?: Record<string, number | null>;
}

const validPrices = (prices?: Record<string, number | null>) => {
  for (const v of Object.values(prices || {})) {
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > 1_000_000_000)) {
      throw new BadRequestException('Un prix doit être un nombre entier positif (en centimes par jour).');
    }
  }
  return prices;
};

/** Super admin only: what is sold, at what price, and what happens at the end of the trial. */
@ApiTags('Licenses (admin)')
@ApiBearerAuth()
@Controller('admin/licenses')
@Roles('super_admin')
@UseGuards(RolesGuard, OtpStepUpGuard)
export class LicensesAdminController {
  constructor(private licenses: LicensesService, private alerts: SecurityAlertsService, private audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'Prices, settings, revenue and recent purchases' })
  overview() {
    return this.licenses.adminOverview();
  }

  @Put('settings')
  @RequireOtp()
  async settings(@Body() dto: SettingsDto, @CurrentUser('id') adminId: string) {
    const result = await this.licenses.updateSettings(adminId, dto);
    await this.audit.log({ user_id: adminId, action: 'license_settings_updated', entity_type: 'license_settings', entity_id: '1', changes: result });
    await this.alerts.alert({ severity: 'warning', title: 'Réglages des licences modifiés', body: `Essai / fin de licence modifiés par ${adminId}.`, data: result as any });
    return result.after;
  }

  @Put('features/:key')
  @RequireOtp()
  async feature(@Param('key') key: string, @Body() dto: FeatureDto, @CurrentUser('id') adminId: string) {
    validPrices(dto.prices);
    const feature = await this.licenses.updateFeature(key, dto);
    await this.audit.log({ user_id: adminId, action: 'license_feature_updated', entity_type: 'license_feature', entity_id: key, changes: dto as any });
    if (dto.prices) await this.alerts.alert({ severity: 'warning', title: 'Prix de licence modifié', body: `Fonctionnalité « ${key} » modifiée par ${adminId}.`, data: { key, prices: dto.prices } });
    return feature;
  }

  @Put('bundle')
  @RequireOtp()
  async bundle(@Body() dto: BundleDto, @CurrentUser('id') adminId: string) {
    validPrices(dto.prices);
    const bundle = await this.licenses.updateBundle(dto.prices || {});
    await this.audit.log({ user_id: adminId, action: 'license_bundle_updated', entity_type: 'license_bundle', entity_id: 'all', changes: dto as any });
    await this.alerts.alert({ severity: 'warning', title: 'Prix « tout inclus » modifié', body: `Modifié par ${adminId}.`, data: { prices: dto.prices } });
    return bundle;
  }
}
