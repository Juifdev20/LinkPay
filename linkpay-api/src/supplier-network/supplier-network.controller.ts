import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { OtpStepUpGuard, RequireOtp } from '../security/otp-step-up.guard';
import { SecurityAlertsService } from '../security/security-alerts.service';
import { AuditService } from '../audit/audit.service';
import { RequireDeviceIntegrity } from '../integrity/device-integrity.guard';
import { RequireSubscription } from '../subscriptions/subscription.guard';
import { Throttle } from '@nestjs/throttler';
import { SupplierNetworkService } from './supplier-network.service';
import { SupplierOrdersService } from './supplier-orders.service';
import { MAX_SUPPLIER_PLAN_MONTHS, SUPPLIER_PLAN_CURRENCIES, SupplierPlanService } from './supplier-plan.service';

/** Upper bounds: 10 billion (in the currency) per price or fee, 1 million units per line — totals stay exact integers. */
const MAX_AMOUNT_CENTS = 1_000_000_000_000;
const MAX_QUANTITY = 1_000_000;

class ProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) display_name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) phone?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) address?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) delivery_zone?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @ApiPropertyOptional({ description: "La station d'où partent les marchandises" }) @IsOptional() @IsUUID() merchant_id?: string;
  @ApiPropertyOptional({ description: 'Frais de livraison proposés par défaut (centimes), modifiables à chaque commande' })
  @IsOptional() @IsInt() @Min(0) @Max(MAX_AMOUNT_CENTS) default_delivery_fee_cents?: number | null;
  @ApiPropertyOptional({ enum: ['CDF', 'USD'] }) @IsOptional() @IsIn(['CDF', 'USD']) default_delivery_currency?: 'CDF' | 'USD' | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional({ description: 'Les stations qui vendent (devenir fournisseur)' })
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true }) merchant_ids?: string[];
}

class StationDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) delivery_zone?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(MAX_AMOUNT_CENTS) default_delivery_fee_cents?: number | null;
  @ApiPropertyOptional({ enum: ['CDF', 'USD'] }) @IsOptional() @IsIn(['CDF', 'USD']) default_delivery_currency?: 'CDF' | 'USD' | null;
}

class PlanQuoteDto {
  @ApiProperty({ enum: ['monthly', 'annual'] }) @IsIn(['monthly', 'annual']) plan!: 'monthly' | 'annual';
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_SUPPLIER_PLAN_MONTHS }) @IsOptional() @IsInt() @Min(1) @Max(MAX_SUPPLIER_PLAN_MONTHS) months?: number;
  @ApiProperty({ enum: SUPPLIER_PLAN_CURRENCIES }) @IsIn([...SUPPLIER_PLAN_CURRENCIES]) currency!: string;
}

class PlanSubscribeDto extends PlanQuoteDto {
  @ApiProperty() @IsString() @Matches(/^\d{4,8}$/, { message: 'PIN invalide' }) pin!: string;
}

class CatalogItemDto {
  @ApiProperty({ description: 'Prix de vente aux entreprises (centimes), dans la devise de l’article' }) @IsInt() @Min(1) @Max(MAX_AMOUNT_CENTS) price_cents!: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(MAX_QUANTITY) min_quantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

class InviteDto {
  @ApiProperty({ example: 'F-482913' }) @IsString() @MaxLength(20) supplier_number!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) message?: string;
}

class LinkActionDto {
  @ApiProperty({ enum: ['accept', 'refuse', 'end'] }) @IsIn(['accept', 'refuse', 'end']) action!: 'accept' | 'refuse' | 'end';
}

class OrderLineDto {
  @ApiProperty() @IsUUID() catalog_item_id!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_QUANTITY) quantity!: number;
}

class CreateOrderDto {
  @ApiProperty() @IsUUID() supplier_org_id!: string;
  @ApiPropertyOptional({ description: 'La station qui reçoit (le patron) — celle du gérant sinon' }) @IsOptional() @IsUUID() merchant_id?: string;
  @ApiPropertyOptional({ description: 'La station du fournisseur qui sert ce client' }) @IsOptional() @IsUUID() supplier_merchant_id?: string;
  @ApiProperty({ type: [OrderLineDto] }) @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => OrderLineDto) items!: OrderLineDto[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() delivery_requested?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) delivery_address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class NoteDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class ConfirmOrderDto extends NoteDto {
  @ApiPropertyOptional({ description: 'Frais de livraison de cette commande (centimes, devise de la commande)' }) @IsOptional() @IsInt() @Min(0) @Max(MAX_AMOUNT_CENTS) delivery_fee_cents?: number;
}

class OfflinePaymentDto {
  @ApiProperty({ enum: ['cash', 'mobile_money'] }) @IsIn(['cash', 'mobile_money']) method!: 'cash' | 'mobile_money';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) reference?: string;
}

class ReceiveLineDto {
  @ApiProperty() @IsUUID() order_item_id!: string;
  @ApiPropertyOptional({ description: 'Le produit de la station qui reçoit cette ligne' }) @IsOptional() @IsUUID() stock_item_id?: string;
  @ApiPropertyOptional({ description: 'Prix de vente d’un produit nouveau (centimes)' }) @IsOptional() @IsInt() @Min(1) @Max(MAX_AMOUNT_CENTS) sale_price_cents?: number;
}

class ReceiveDto {
  @ApiPropertyOptional({ type: [ReceiveLineDto] }) @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ReceiveLineDto) lines?: ReceiveLineDto[];
}

/** The supplier network, all sectors (DECISIONS.md 23/10, phase C). Roles are checked in the services. */
@ApiTags('Supplier network')
@ApiBearerAuth()
@Controller('organizations/:id')
@Roles('enterprise', 'gerant', 'magasinier')
@UseGuards(RolesGuard)
export class SupplierNetworkController {
  constructor(private network: SupplierNetworkService, private orders: SupplierOrdersService, private plan: SupplierPlanService) {}

  // ---- becoming a supplier, the plan
  @Get('supplier-profile')
  @ApiOperation({ summary: 'Supplier profile and plan of this enterprise (or null), with the offer: free trial and prices set by the super admin' })
  profile(@Param('id') id: string, @CurrentUser() caller: any) {
    return this.network.myProfile(id, caller);
  }

  @Post('supplier-profile')
  @RequireSubscription('org')
  @ApiOperation({ summary: 'Become a supplier (owner): a supplier number, the shipping station, the free trial starts' })
  become(@Param('id') id: string, @Body() dto: ProfileDto, @CurrentUser() caller: any) {
    return this.network.becomeSupplier(id, caller, dto);
  }

  @Put('supplier-profile')
  @ApiOperation({ summary: 'Change the supplier profile, or pause it (owner)' })
  updateProfile(@Param('id') id: string, @Body() dto: ProfileDto, @CurrentUser() caller: any) {
    return this.network.updateProfile(id, caller, dto);
  }

  @Post('supplier-plan/quote')
  @ApiOperation({ summary: 'Price of the Fournisseur plan (monthly × N, or the year with the months offered)' })
  async quote(@Param('id') id: string, @Body() dto: PlanQuoteDto, @CurrentUser() caller: any) {
    await this.network.member(id, caller);
    return this.plan.quote(dto);
  }

  @Post('supplier-plan/subscribe')
  @RequireDeviceIntegrity()
  @ApiOperation({ summary: "Pay the Fournisseur plan from the owner's wallet (PIN). Header Idempotency-Key required." })
  subscribe(@Param('id') id: string, @Body() dto: PlanSubscribeDto, @Headers('idempotency-key') key: string | undefined, @CurrentUser('id') userId: string) {
    if (!key) throw new BadRequestException('Idempotency-Key header is required');
    return this.plan.subscribe(userId, id, dto, key);
  }

  // ---- catalog (supplier side)
  @Get('supplier-catalog')
  @ApiOperation({ summary: "Articles of the shipping station, with their business price when in the catalog" })
  catalog(@Param('id') id: string, @Query('merchant_id') merchantId: string | undefined, @CurrentUser() caller: any) {
    return this.network.myCatalog(id, caller, merchantId || undefined);
  }

  @Put('supplier-stations/:merchantId')
  @ApiOperation({ summary: 'Owner: a station sells to enterprises or not, its delivery zone and default delivery fee' })
  setStation(@Param('id') id: string, @Param('merchantId') merchantId: string, @Body() dto: StationDto, @CurrentUser() caller: any) {
    return this.network.setStation(id, caller, merchantId, dto);
  }

  @Put('supplier-catalog/:stockItemId')
  @RequireSubscription('org')
  @ApiOperation({ summary: 'Put an article in the catalog / change its business price / take it out (active false)' })
  setCatalogItem(@Param('id') id: string, @Param('stockItemId') stockItemId: string, @Body() dto: CatalogItemDto, @CurrentUser() caller: any) {
    return this.network.setCatalogItem(id, caller, stockItemId, dto);
  }

  // ---- links
  @Get('supplier-lookup')
  // Numbers are short: no trying them one after the other.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: "A supplier's public card from its number (before inviting it)" })
  lookup(@Param('id') id: string, @Query('number') number: string, @CurrentUser() caller: any) {
    return this.network.lookup(id, caller, number);
  }

  @Get('supplier-links')
  @ApiOperation({ summary: 'My suppliers (as a client) and my clients (as a supplier)' })
  links(@Param('id') id: string, @CurrentUser() caller: any) {
    return this.network.listLinks(id, caller);
  }

  @Post('supplier-links')
  @RequireSubscription('org')
  @ApiOperation({ summary: 'Invite a supplier by its number' })
  invite(@Param('id') id: string, @Body() dto: InviteDto, @CurrentUser() caller: any) {
    return this.network.invite(id, caller, dto);
  }

  @Put('supplier-links/:linkId')
  @ApiOperation({ summary: 'Accept / refuse an invitation (supplier), or end a link (either side)' })
  decide(@Param('id') id: string, @Param('linkId') linkId: string, @Body() dto: LinkActionDto, @CurrentUser() caller: any) {
    return this.network.decideLink(id, caller, linkId, dto.action);
  }

  @Get('supplier-network/:supplierOrgId/catalog')
  @ApiOperation({ summary: 'The catalog of a supplier that accepted this enterprise' })
  supplierCatalog(@Param('id') id: string, @Param('supplierOrgId') supplierOrgId: string, @CurrentUser() caller: any) {
    return this.network.supplierCatalog(id, caller, supplierOrgId);
  }

  // ---- orders
  @Get('supplier-orders')
  @ApiOperation({ summary: "Orders — side=client (what we bought) or side=supplier (what we sell)" })
  listOrders(@Param('id') id: string, @Query('side') side: string, @Query('status') status: string | undefined, @CurrentUser() caller: any) {
    return this.orders.list(id, caller, side === 'supplier' ? 'supplier' : 'client', status || undefined);
  }

  @Get('supplier-orders/:orderId')
  getOrder(@Param('id') id: string, @Param('orderId') orderId: string, @CurrentUser() caller: any) {
    return this.orders.get(id, orderId, caller);
  }

  @Post('supplier-orders')
  @RequireSubscription('org')
  @ApiOperation({ summary: 'Order from the catalog of a supplier (owner, manager)' })
  createOrder(@Param('id') id: string, @Body() dto: CreateOrderDto, @CurrentUser() caller: any) {
    return this.orders.create(id, caller, dto);
  }

  @Post('supplier-orders/:orderId/cancel')
  cancel(@Param('id') id: string, @Param('orderId') orderId: string, @Body() dto: NoteDto, @CurrentUser() caller: any) {
    return this.orders.cancel(id, orderId, caller, dto.note);
  }

  @Post('supplier-orders/:orderId/declare-payment')
  @ApiOperation({ summary: 'Client: "paid in cash / by Mobile Money" — the supplier confirms it' })
  declarePayment(@Param('id') id: string, @Param('orderId') orderId: string, @Body() dto: OfflinePaymentDto, @CurrentUser() caller: any) {
    return this.orders.declarePayment(id, orderId, caller, dto);
  }

  @Post('supplier-orders/:orderId/confirm')
  @ApiOperation({ summary: "Supplier: confirm the order and set this order's delivery fee" })
  confirm(@Param('id') id: string, @Param('orderId') orderId: string, @Body() dto: ConfirmOrderDto, @CurrentUser() caller: any) {
    return this.orders.confirm(id, orderId, caller, dto);
  }

  @Post('supplier-orders/:orderId/refuse')
  refuse(@Param('id') id: string, @Param('orderId') orderId: string, @Body() dto: NoteDto, @CurrentUser() caller: any) {
    return this.orders.refuse(id, orderId, caller, dto.note);
  }

  @Post('supplier-orders/:orderId/confirm-payment')
  @ApiOperation({ summary: 'Supplier: the money was received outside the app (cash, Mobile Money)' })
  confirmPayment(@Param('id') id: string, @Param('orderId') orderId: string, @Body() dto: OfflinePaymentDto, @CurrentUser() caller: any) {
    return this.orders.confirmPayment(id, orderId, caller, dto);
  }

  @Post('supplier-orders/:orderId/deliver')
  @ApiOperation({ summary: "Supplier: validate the delivery (the shipping station's stock goes out)" })
  deliver(@Param('id') id: string, @Param('orderId') orderId: string, @CurrentUser() caller: any) {
    return this.orders.deliver(id, orderId, caller);
  }

  @Post('supplier-orders/:orderId/receive')
  @ApiOperation({ summary: 'Client: confirm reception (stock comes in, purchase price updated)' })
  receive(@Param('id') id: string, @Param('orderId') orderId: string, @Body() dto: ReceiveDto, @CurrentUser() caller: any) {
    return this.orders.receive(id, orderId, caller, dto);
  }
}

class PlanSettingsDto {
  @IsOptional() @IsInt() @Min(0) @Max(365) trial_days?: number;
  @IsOptional() @IsInt() @Min(0) @Max(11) annual_free_months?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsInt({ each: true }) @Min(1, { each: true }) @Max(90, { each: true }) reminder_days?: number[];
}

class PlanPricesDto {
  /** { CDF: 2800000, USD: 1000 } in cents per month; null takes the plan off sale in that currency. */
  @IsOptional() prices?: Record<string, number | null>;
}

/** Super admin: the Fournisseur plan's trial, prices and annual discount. */
@ApiTags('Supplier network (admin)')
@ApiBearerAuth()
@Controller('admin/supplier-plan')
@Roles('super_admin')
@UseGuards(RolesGuard, OtpStepUpGuard)
export class SupplierPlanAdminController {
  constructor(private plan: SupplierPlanService, private alerts: SecurityAlertsService, private audit: AuditService) {}

  @Get()
  overview() {
    return this.plan.adminOverview();
  }

  @Put('settings')
  @RequireOtp()
  async settings(@Body() dto: PlanSettingsDto, @CurrentUser('id') adminId: string) {
    const result = await this.plan.updateSettings(adminId, dto);
    await this.audit.log({ user_id: adminId, action: 'supplier_plan_settings_updated', entity_type: 'supplier_plan_settings', entity_id: '1', changes: result });
    await this.alerts.alert({ severity: 'warning', title: 'Réglages de l’abonnement Fournisseur modifiés', body: `Modifiés par ${adminId}.`, data: result as any });
    return result.after;
  }

  @Put('prices')
  @RequireOtp()
  async prices(@Body() dto: PlanPricesDto, @CurrentUser('id') adminId: string) {
    for (const v of Object.values(dto.prices || {})) {
      if (v !== null && (!Number.isInteger(v) || v < 1 || v > 1_000_000_000_000)) {
        throw new BadRequestException('Le prix doit être un nombre entier positif (en centimes par mois).');
      }
    }
    const result = await this.plan.updatePrices(dto.prices || {});
    await this.audit.log({ user_id: adminId, action: 'supplier_plan_price_updated', entity_type: 'supplier_plan_prices', entity_id: 'month', changes: result });
    await this.alerts.alert({ severity: 'warning', title: 'Prix de l’abonnement Fournisseur modifié', body: `Modifié par ${adminId}.`, data: result as any });
    return result.after;
  }
}
