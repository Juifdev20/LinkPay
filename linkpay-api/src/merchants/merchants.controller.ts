import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MerchantsService } from './merchants.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { IsString, IsOptional, MaxLength, IsEmail, IsIn, IsUUID, ValidateNested, Matches } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class AddMerchantUserDto {
  @ApiProperty({ example: 'caissier@example.com' })
  @IsEmail()
  email!: string;
}

export class CreateMerchantDto {
  @ApiProperty({ example: 'Boutique Mukendi' })
  @IsString()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  legal_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ default: 'CDF', enum: ['CDF', 'USD'], description: 'Default currency for new payment links from this shop' })
  @IsOptional()
  @IsIn(['CDF', 'USD'])
  default_currency?: string;
}

/** Where the platform sends this store's settlements. */
export class SettlementAccountDto {
  @ApiProperty({ enum: ['mobile_money', 'bank'] })
  @IsIn(['mobile_money', 'bank'])
  method!: string;

  @ApiPropertyOptional({ example: 'M-Pesa', description: 'Mobile Money operator (M-Pesa, Orange Money, Airtel Money, Afrimoney)' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  operator?: string;

  @ApiPropertyOptional({ example: 'Rawbank', description: 'Bank name (bank transfers)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bank_name?: string;

  @ApiProperty({ example: '0990000000', description: 'Mobile Money number or bank account number' })
  @IsString()
  @Matches(/^[0-9A-Za-z +-]{6,40}$/, { message: 'Numéro de compte invalide' })
  number!: string;

  @ApiProperty({ example: 'Jean Mukendi', description: 'Account holder name' })
  @IsString()
  @MaxLength(255)
  holder_name!: string;
}

export class UpdateMerchantDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  legal_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ enum: ['CDF', 'USD'] })
  @IsOptional()
  @IsIn(['CDF', 'USD'])
  default_currency?: string;

  @ApiPropertyOptional({ type: SettlementAccountDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SettlementAccountDto)
  settlement_account?: SettlementAccountDto;

  @ApiPropertyOptional({ description: 'Admin only' })
  @IsOptional()
  @IsIn(['pending', 'active', 'suspended', 'rejected', 'closed'])
  status?: string;

  @ApiPropertyOptional({ description: 'Admin only' })
  @IsOptional()
  @IsUUID()
  commission_rule_id?: string;
}

@ApiTags('Merchants')
@ApiBearerAuth()
@Controller('merchants')
export class MerchantsController {
  constructor(private merchantsService: MerchantsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a merchant account' })
  async createMerchant(
    @CurrentUser('id') userId: string,
    @CurrentUser('email') email: string,
    @Body() dto: CreateMerchantDto,
  ) {
    return this.merchantsService.createMerchant(userId, email, dto);
  }

  // An owner with more than one store (e.g. an enterprise account that has
  // created several) has more than one `merchants` row with the same
  // owner_id — getMerchantByOwner()'s `.single()` breaks the moment that's
  // true. The JWT's own merchant_id claim (set at login/upgrade/enter-store
  // time) says exactly which store this request means; only fall back to
  // the owner lookup for a token that predates/lacks that claim.
  @Get('me')
  @ApiOperation({ summary: 'Get current user merchant account' })
  async getMyMerchant(@CurrentUser('id') userId: string, @CurrentUser('merchant_id') merchantId?: string) {
    if (merchantId) return this.merchantsService.getMerchantById(merchantId);
    return this.merchantsService.getMerchantByOwner(userId);
  }

  @Get('me/stats')
  @ApiOperation({ summary: 'Get current user merchant dashboard stats' })
  async getMyMerchantStats(@CurrentUser('id') userId: string, @CurrentUser('merchant_id') merchantId?: string) {
    if (merchantId) return this.merchantsService.getMerchantStats(merchantId);
    const merchant = await this.merchantsService.getMerchantByOwner(userId);
    return this.merchantsService.getMerchantStats(merchant.id);
  }

  // Privileged fields on a merchant record — never settable by the merchant
  // owner themselves, only by platform admins. `status` also has its own
  // dedicated, already-admin-gated route (AdminController.updateMerchantStatus)
  // for the approve/reject/suspend workflow; kept reachable here too (admin
  // callers only) since `commission_rule_id` has no other admin endpoint yet.
  private static readonly ADMIN_ONLY_FIELDS = ['status', 'commission_rule_id'];

  @Get(':id')
  @ApiOperation({ summary: 'Get merchant by ID (owner or admin only)' })
  async getMerchant(
    @Param('id') id: string,
    @CurrentUser('merchant_id') callerMerchantId: string,
    @CurrentUser('role') callerRole: string,
  ) {
    this.assertOwnMerchantOrAdmin(id, callerMerchantId, callerRole);
    return this.merchantsService.getMerchantById(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update merchant (store owner or admin only — status/commission_rule_id require admin)' })
  async updateMerchant(
    @Param('id') id: string,
    @Body() updates: UpdateMerchantDto,
    @CurrentUser('merchant_id') callerMerchantId: string,
    @CurrentUser('role') callerRole: string,
  ) {
    if (!this.isAdmin(callerRole)) {
      // A cashier's token carries the store's merchant_id too — without this
      // they could rename the store or change where its money is paid out.
      // ('merchant' also covers an enterprise owner acting as their store.)
      if (callerRole !== 'merchant') {
        throw new ForbiddenException('Seul le propriétaire de la boutique peut la modifier');
      }
      this.assertOwnMerchant(id, callerMerchantId);
      const attemptedPrivileged = MerchantsController.ADMIN_ONLY_FIELDS.filter((f) => (updates as any)[f] !== undefined);
      if (attemptedPrivileged.length > 0) {
        throw new ForbiddenException(`Only an administrator can change: ${attemptedPrivileged.join(', ')}`);
      }
    }
    return this.merchantsService.updateMerchant(id, { ...updates });
  }

  @Get(':id/stats')
  @ApiOperation({ summary: 'Get merchant dashboard stats (owner or admin only)' })
  async getMerchantStats(
    @Param('id') id: string,
    @CurrentUser('merchant_id') callerMerchantId: string,
    @CurrentUser('role') callerRole: string,
  ) {
    this.assertOwnMerchantOrAdmin(id, callerMerchantId, callerRole);
    return this.merchantsService.getMerchantStats(id);
  }

  @Get(':id/users')
  @Roles('merchant')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Get merchant team members (owner only)' })
  async getMerchantUsers(
    @Param('id') id: string,
    @CurrentUser('merchant_id') callerMerchantId: string,
  ) {
    this.assertOwnMerchant(id, callerMerchantId);
    return this.merchantsService.getMerchantUsers(id);
  }

  @Post(':id/users')
  @Roles('merchant')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Invite an existing ScanLinkPay user as cashier (owner only)' })
  async addMerchantUser(
    @Param('id') id: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('merchant_id') callerMerchantId: string,
    @Body() dto: AddMerchantUserDto,
  ) {
    this.assertOwnMerchant(id, callerMerchantId);
    return this.merchantsService.addMerchantUser(id, callerId, { email: dto.email });
  }

  @Delete(':id/users/:userId')
  @Roles('merchant')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Remove a cashier from the merchant team (owner only)' })
  async removeMerchantUser(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('merchant_id') callerMerchantId: string,
  ) {
    this.assertOwnMerchant(id, callerMerchantId);
    return this.merchantsService.removeMerchantUser(id, callerId, userId);
  }

  private assertOwnMerchant(paramMerchantId: string, callerMerchantId: string | undefined) {
    if (!callerMerchantId || callerMerchantId !== paramMerchantId) {
      throw new ForbiddenException('You do not manage this merchant account');
    }
  }

  private isAdmin(role: string | undefined): boolean {
    return role === 'admin' || role === 'super_admin';
  }

  private assertOwnMerchantOrAdmin(paramMerchantId: string, callerMerchantId: string | undefined, callerRole: string | undefined) {
    if (this.isAdmin(callerRole)) return;
    this.assertOwnMerchant(paramMerchantId, callerMerchantId);
  }
}
