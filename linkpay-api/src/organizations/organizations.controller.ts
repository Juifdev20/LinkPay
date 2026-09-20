import { Controller, Get, Post, Put, Body, Param, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { IsString, IsOptional, MaxLength, IsObject, IsNumber, IsIn, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateMerchantDto } from '../merchants/merchants.controller';

class CreateOrganizationDto {
  @ApiProperty({ example: 'Tech Solutions SARL' })
  @IsString()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  legal_name?: string;

  @ApiPropertyOptional({ description: 'Contact info object: {phone, email, address}' })
  @IsOptional()
  @IsObject()
  contact?: Record<string, any>;
}

class CreateExpenseDto {
  @ApiProperty({ example: 15000, description: 'Amount in cents' })
  @IsNumber()
  @Min(1)
  @Max(99999999999)
  amount_cents!: number;

  @ApiPropertyOptional({ default: 'CDF', enum: ['CDF', 'USD'] })
  @IsOptional()
  @IsIn(['CDF', 'USD'])
  currency?: string;

  @ApiPropertyOptional({ example: 'Achat de fournitures' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

@ApiTags('Organizations')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(private orgsService: OrganizationsService) {}

  @Post()
  @ApiOperation({ summary: 'Create an organization account' })
  async create(
    @CurrentUser('id') userId: string,
    @CurrentUser('email') email: string,
    @Body() dto: CreateOrganizationDto,
  ) {
    return this.orgsService.createOrganization(userId, email, dto);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user organization' })
  async getMyOrg(@CurrentUser('id') userId: string) {
    return this.orgsService.getOrganizationByOwner(userId);
  }

  @Public()
  @Get('pay/:number')
  @ApiOperation({ summary: 'Look up a business by its ScanLinkPay number (public — no auth)' })
  async getOrgByScanLinkPayNumber(@Param('number') number: string) {
    return this.orgsService.getOrganizationByScanLinkPayNumber(number);
  }

  // Privileged field on an organization record — never settable by the
  // owner themselves, only by platform admins (mirrors merchants.controller.ts).
  private static readonly ADMIN_ONLY_FIELDS = ['status'];

  @Get(':id')
  @ApiOperation({ summary: 'Get organization by ID (owner or admin only)' })
  async getOrg(
    @Param('id') id: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
  ) {
    const org = await this.orgsService.getOrganizationById(id);
    this.assertOwnOrgOrAdmin(org.owner_id, callerId, callerRole);
    return org;
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update organization (owner or admin only — status requires admin)' })
  async updateOrg(
    @Param('id') id: string,
    @Body() updates: Record<string, any>,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
  ) {
    const org = await this.orgsService.getOrganizationById(id);
    this.assertOwnOrgOrAdmin(org.owner_id, callerId, callerRole);
    if (!this.isAdmin(callerRole)) {
      const attemptedPrivileged = OrganizationsController.ADMIN_ONLY_FIELDS.filter((f) => updates[f] !== undefined);
      if (attemptedPrivileged.length > 0) {
        throw new ForbiddenException(`Only an administrator can change: ${attemptedPrivileged.join(', ')}`);
      }
    }
    return this.orgsService.updateOrganization(id, updates);
  }

  @Post(':id/merchants')
  @ApiOperation({ summary: 'Create a new store under this organization (owner only)' })
  async createOrgMerchant(
    @Param('id') id: string,
    @Body() dto: CreateMerchantDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('email') email: string,
  ) {
    const org = await this.orgsService.getOrganizationById(id);
    this.assertOwnOrg(org.owner_id, callerId);
    return this.orgsService.createOrganizationMerchant(id, callerId, email, dto);
  }

  @Get(':id/merchants')
  @ApiOperation({ summary: "List this organization's stores (owner only)" })
  async listOrgMerchants(@Param('id') id: string, @CurrentUser('id') callerId: string) {
    const org = await this.orgsService.getOrganizationById(id);
    this.assertOwnOrg(org.owner_id, callerId);
    return this.orgsService.getOrganizationMerchants(id);
  }

  @Get(':id/stats')
  @ApiOperation({ summary: 'Get aggregated stats across every store in this organization (owner only)' })
  async getOrgStats(@Param('id') id: string, @CurrentUser('id') callerId: string) {
    const org = await this.orgsService.getOrganizationById(id);
    this.assertOwnOrg(org.owner_id, callerId);
    return this.orgsService.getOrganizationStats(id);
  }

  @Get(':id/stores-breakdown')
  @ApiOperation({ summary: 'Get per-store stats, sorted by volume (owner only)' })
  async getOrgStoresBreakdown(@Param('id') id: string, @CurrentUser('id') callerId: string) {
    const org = await this.orgsService.getOrganizationById(id);
    this.assertOwnOrg(org.owner_id, callerId);
    return this.orgsService.getOrganizationStoresBreakdown(id);
  }

  @Get(':id/recent-transactions')
  @ApiOperation({ summary: 'Get the latest transactions across every store in this organization (owner only)' })
  async getOrgRecentTransactions(@Param('id') id: string, @CurrentUser('id') callerId: string) {
    const org = await this.orgsService.getOrganizationById(id);
    this.assertOwnOrg(org.owner_id, callerId);
    return this.orgsService.getOrganizationRecentTransactions(id);
  }

  @Post(':id/expenses')
  @ApiOperation({ summary: 'Record a manual expense (owner only)' })
  async createOrgExpense(
    @Param('id') id: string,
    @Body() dto: CreateExpenseDto,
    @CurrentUser('id') callerId: string,
  ) {
    const org = await this.orgsService.getOrganizationById(id);
    this.assertOwnOrg(org.owner_id, callerId);
    return this.orgsService.createExpense(id, callerId, dto);
  }

  @Get(':id/expenses')
  @ApiOperation({ summary: 'List recorded expenses (owner only)' })
  async listOrgExpenses(@Param('id') id: string, @CurrentUser('id') callerId: string) {
    const org = await this.orgsService.getOrganizationById(id);
    this.assertOwnOrg(org.owner_id, callerId);
    return this.orgsService.getExpenses(id);
  }

  @Get(':id/expenses-summary')
  @ApiOperation({ summary: 'Get total expenses by currency (owner only)' })
  async getOrgExpensesSummary(@Param('id') id: string, @CurrentUser('id') callerId: string) {
    const org = await this.orgsService.getOrganizationById(id);
    this.assertOwnOrg(org.owner_id, callerId);
    return this.orgsService.getExpensesSummary(id);
  }

  @Post(':id/merchants/:merchantId/enter')
  @ApiOperation({ summary: 'Get a merchant-scoped session for one of this organization\'s stores (owner only)' })
  async enterOrgMerchant(
    @Param('id') id: string,
    @Param('merchantId') merchantId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('email') email: string,
    @CurrentUser('session_id') sessionId?: string,
  ) {
    const org = await this.orgsService.getOrganizationById(id);
    this.assertOwnOrg(org.owner_id, callerId);
    return this.orgsService.enterOrganizationMerchant(id, callerId, email, merchantId, sessionId);
  }

  private isAdmin(role: string | undefined): boolean {
    return role === 'admin' || role === 'super_admin';
  }

  private assertOwnOrgOrAdmin(ownerId: string | undefined, callerId: string | undefined, callerRole: string | undefined) {
    if (this.isAdmin(callerRole)) return;
    this.assertOwnOrg(ownerId, callerId);
  }

  // Store management is intentionally owner-only, even for platform admins
  // (unlike getOrg/updateOrg above) — admins manage individual merchants
  // through their own existing merchant-admin surface, not by acting as an
  // organization's owner.
  private assertOwnOrg(ownerId: string | undefined, callerId: string | undefined) {
    if (!callerId || callerId !== ownerId) {
      throw new ForbiddenException('You do not manage this organization account');
    }
  }
}
