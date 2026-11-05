import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { OtpStepUpGuard, RequireOtp } from '../security/otp-step-up.guard';
import { SecurityAlertsService } from '../security/security-alerts.service';
import { AuditService } from '../audit/audit.service';
import { SubscriptionsService } from './subscriptions.service';
import { MAX_SUBSCRIPTION_MONTHS, SUBSCRIPTION_CURRENCIES, SUBSCRIPTION_MODES } from './subscription';
import { RequireDeviceIntegrity } from '../integrity/device-integrity.guard';

export class QuoteDto {
  @ApiProperty({ minimum: 1, maximum: MAX_SUBSCRIPTION_MONTHS })
  @IsInt()
  @Min(1)
  @Max(MAX_SUBSCRIPTION_MONTHS)
  months!: number;

  @ApiProperty({ enum: SUBSCRIPTION_CURRENCIES })
  @IsIn([...SUBSCRIPTION_CURRENCIES])
  currency!: string;
}

export class SubscribeDto extends QuoteDto {
  @ApiProperty({ description: 'Transaction PIN of the wallet' })
  @IsString()
  @Matches(/^\d{4,8}$/, { message: 'PIN invalide' })
  pin!: string;
}

/** What the business owner sees and does. */
@ApiTags('Subscriptions')
@ApiBearerAuth()
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private subscriptions: SubscriptionsService) {}

  /** Reachable by the owner and by their staff (the screens need to know what is usable), not by plain clients. */
  @Get('organizations/:id')
  @Roles('enterprise', 'gerant', 'comptable', 'caissier', 'magasinier', 'vendeur', 'admin', 'super_admin')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Subscription status of this business (trial, active, expired) and the monthly price' })
  async state(@Param('id') id: string, @CurrentUser('id') userId: string, @CurrentUser('organization_id') callerOrgId: string | undefined, @CurrentUser('role') role: string) {
    await this.subscriptions.assertMember(id, userId, callerOrgId, role);
    const state = await this.subscriptions.getState(id);
    // Till and stock staff only need to know whether the tools are usable — not what the business pays.
    if (['caissier', 'magasinier', 'vendeur', 'comptable'].includes(role)) return { ...state, prices: {} };
    return state;
  }

  @Post('organizations/:id/quote')
  @Roles('enterprise', 'gerant', 'admin', 'super_admin')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Price of N months before paying' })
  async quote(@Param('id') id: string, @Body() dto: QuoteDto, @CurrentUser('id') userId: string, @CurrentUser('organization_id') callerOrgId: string | undefined, @CurrentUser('role') role: string) {
    await this.subscriptions.assertMember(id, userId, callerOrgId, role);
    return this.subscriptions.quote(dto);
  }

  @Post('organizations/:id/subscribe')
  @RequireDeviceIntegrity()
  @Roles('enterprise', 'gerant')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: "Pay N months of subscription from the owner's wallet. Header Idempotency-Key required." })
  async subscribe(
    @Param('id') id: string,
    @Body() dto: SubscribeDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('organization_id') callerOrgId: string | undefined,
  ) {
    if (!idempotencyKey) throw new BadRequestException('Idempotency-Key header is required');
    return this.subscriptions.subscribe(userId, id, dto, idempotencyKey, { role, organizationId: callerOrgId });
  }
}

export class SettingsDto {
  @IsOptional() @IsInt() @Min(0) @Max(365) trial_days?: number;
  @IsOptional() @IsIn(SUBSCRIPTION_MODES) trial_end_mode?: 'read_only' | 'blocked';
  @IsOptional() @IsIn(SUBSCRIPTION_MODES) expiry_mode?: 'read_only' | 'blocked';
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsInt({ each: true }) @Min(1, { each: true }) @Max(90, { each: true }) reminder_days?: number[];
}

export class PricesDto {
  /** { CDF: 1500000, USD: 1000 } in cents per month; null removes the price. */
  @IsOptional() prices?: Record<string, number | null>;
}

export class GrantDto {
  @ApiProperty({ description: 'Nombre de jours (1 à 730) ou de mois (1 à 24)', example: 30 })
  @Type(() => Number) @IsInt() @Min(1) @Max(730) amount!: number;
  @ApiProperty({ enum: ['days', 'months'] }) @IsIn(['days', 'months']) unit!: 'days' | 'months';
  @ApiProperty({ required: false, description: "Motif (test, geste commercial, dépannage…)" }) @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class RevokeDto {
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
  @ApiProperty({ required: false, description: "Obligatoire si l'entreprise a payé un abonnement qui court encore" })
  @IsOptional() @IsBoolean() confirm_paid?: boolean;
}

export class ListOrganizationsDto {
  @IsOptional() @IsString() @MaxLength(80) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

const validPrices = (prices?: Record<string, number | null>) => {
  for (const v of Object.values(prices || {})) {
    if (v !== null && (!Number.isInteger(v) || v < 1 || v > 1_000_000_000_000)) {
      throw new BadRequestException('Le prix doit être un nombre entier positif (en centimes par mois).');
    }
  }
  return prices || {};
};

/** Super admin only: the monthly price, the trial, and what happens when it ends. */
@ApiTags('Subscriptions (admin)')
@ApiBearerAuth()
@Controller('admin/subscription')
@Roles('super_admin')
@UseGuards(RolesGuard, OtpStepUpGuard)
export class SubscriptionsAdminController {
  constructor(private subscriptions: SubscriptionsService, private alerts: SecurityAlertsService, private audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'Price, settings, revenue and recent payments' })
  overview() {
    return this.subscriptions.adminOverview();
  }

  @Put('settings')
  @RequireOtp()
  async settings(@Body() dto: SettingsDto, @CurrentUser('id') adminId: string) {
    const result = await this.subscriptions.updateSettings(adminId, dto);
    await this.audit.log({ user_id: adminId, action: 'subscription_settings_updated', entity_type: 'subscription_settings', entity_id: '1', changes: result });
    await this.alerts.alert({ severity: 'warning', title: "Réglages de l'abonnement modifiés", body: `Essai / fin d'abonnement modifiés par ${adminId}.`, data: result as any });
    return result.after;
  }

  @Put('prices')
  @RequireOtp()
  async prices(@Body() dto: PricesDto, @CurrentUser('id') adminId: string) {
    const result = await this.subscriptions.updatePrices(validPrices(dto.prices));
    await this.audit.log({ user_id: adminId, action: 'subscription_price_updated', entity_type: 'subscription_prices', entity_id: 'month', changes: result });
    await this.alerts.alert({ severity: 'warning', title: "Prix de l'abonnement modifié", body: `Modifié par ${adminId}.`, data: result as any });
    return result.after;
  }

  // ------------------------------------------------------------------ activation manuelle (essais, dépannage, gestes commerciaux)

  @Get('organizations')
  @ApiOperation({ summary: 'Entreprises avec leur abonnement (recherche par nom)' })
  organizations(@Query() q: ListOrganizationsDto) {
    return this.subscriptions.adminOrganizations(q);
  }

  @Get('organizations/:id')
  @ApiOperation({ summary: "Une entreprise : état, activations manuelles et paiements" })
  organization(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptions.adminOrganizationDetail(id);
  }

  @Post('organizations/:id/grant')
  @RequireOtp()
  @ApiOperation({ summary: "Active l'abonnement d'une entreprise pour N jours ou N mois, sans paiement" })
  async grant(@Param('id', ParseUUIDPipe) id: string, @Body() dto: GrantDto, @CurrentUser('id') adminId: string) {
    const result = await this.subscriptions.grant(adminId, id, dto);
    await this.audit.log({ user_id: adminId, action: 'subscription_granted', entity_type: 'organization', entity_id: id, changes: { amount: dto.amount, unit: dto.unit, reason: dto.reason ?? null, expires_at: result.expires_at } });
    await this.alerts.alert({ severity: 'warning', title: 'Abonnement activé à la main', body: `${result.name} : ${dto.amount} ${dto.unit === 'days' ? 'jour(s)' : 'mois'} offerts par ${adminId}.`, data: { organization_id: id, ...dto, expires_at: result.expires_at } as any });
    return result;
  }

  @Post('organizations/:id/revoke')
  @RequireOtp()
  @ApiOperation({ summary: "Désactive l'abonnement en cours d'une entreprise (elle pourra en acheter un)" })
  async revoke(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RevokeDto, @CurrentUser('id') adminId: string) {
    const result = await this.subscriptions.revoke(adminId, id, dto);
    await this.audit.log({ user_id: adminId, action: 'subscription_revoked', entity_type: 'organization', entity_id: id, changes: { reason: dto.reason ?? null, previous_expires_at: result.previous_expires_at, confirmed_paid: !!dto.confirm_paid } });
    await this.alerts.alert({ severity: 'warning', title: 'Abonnement désactivé à la main', body: `${result.name} : désactivé par ${adminId}.`, data: { organization_id: id, previous_expires_at: result.previous_expires_at } as any });
    return result;
  }
}
