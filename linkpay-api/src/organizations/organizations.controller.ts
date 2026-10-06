import { Controller, Get, Post, Put, Body, Param, Query, ForbiddenException } from '@nestjs/common';
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

class RejectOrganizationDto {
  @ApiProperty({ example: 'Numéro RCCM illisible sur le document fourni' })
  @IsString()
  @MaxLength(1000)
  reason!: string;
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
  @ApiOperation({ summary: 'Get current user organization (owner) or the organization they staff (magasinier/vendeur/caissier/comptable)' })
  async getMyOrg(@CurrentUser('id') userId: string, @CurrentUser('organization_id') callerOrgId?: string) {
    try {
      return await this.orgsService.getOrganizationByOwner(userId);
    } catch (err) {
      // Not an owner — fall back to the org an enterprise-staff member
      // belongs to (see organization-staff module; their JWT carries
      // organization_id, not an owned org row). Re-throw the original
      // NotFoundException for a caller with neither (e.g. a client/merchant
      // hitting this by mistake).
      if (callerOrgId) return this.orgsService.getOrganizationById(callerOrgId);
      throw err;
    }
  }

  @Public()
  @Get('pay/:number')
  @ApiOperation({ summary: 'Look up a business by its ScanLinkPay number (public — no auth)' })
  async getOrgByScanLinkPayNumber(@Param('number') number: string) {
    return this.orgsService.getOrganizationByScanLinkPayNumber(number);
  }

  // Privileged fields on an organization record — never settable by the
  // owner themselves, only by platform admins (mirrors merchants.controller.ts).
  // The submission-review lifecycle fields are also never meant to go
  // through this generic PUT at all — submit/validate/reject below own
  // them exclusively — but they're listed here too as defense in depth.
  private static readonly ADMIN_ONLY_FIELDS = ['status', 'submitted_at', 'rejection_reason', 'validated_at', 'validated_by'];

  @Get(':id')
  @ApiOperation({ summary: 'Get organization by ID (owner, its staff, or admin)' })
  async getOrg(
    @Param('id') id: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    const org = await this.orgsService.getOrganizationById(id);
    if (!this.isAdmin(callerRole)) {
      this.assertOwnOrgOrStaff(org, callerId, callerOrgId);
    }
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

  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit completed onboarding for super-admin review (owner only)' })
  async submitOrg(@Param('id') id: string, @CurrentUser('id') callerId: string) {
    const org = await this.orgsService.getOrganizationById(id);
    this.assertOwnOrg(org.owner_id, callerId);
    return this.orgsService.submitOrganization(id);
  }

  @Post(':id/validate')
  @ApiOperation({ summary: 'Validate a submitted organization — activates it and issues its ScanLinkPay number (admin only)' })
  async validateOrg(
    @Param('id') id: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
  ) {
    if (!this.isAdmin(callerRole)) {
      throw new ForbiddenException('Only an administrator can validate an organization');
    }
    return this.orgsService.validateOrganization(id, callerId);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject a submitted organization with a reason (admin only)' })
  async rejectOrg(
    @Param('id') id: string,
    @Body() dto: RejectOrganizationDto,
    @CurrentUser('role') callerRole: string,
  ) {
    if (!this.isAdmin(callerRole)) {
      throw new ForbiddenException('Only an administrator can reject an organization');
    }
    return this.orgsService.rejectOrganization(id, dto.reason);
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
  @ApiOperation({ summary: "List this organization's stores (owner or its staff)" })
  async listOrgMerchants(
    @Param('id') id: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    const org = await this.orgsService.getOrganizationById(id);
    this.assertOwnOrgOrStaff(org, callerId, callerOrgId);
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

  @Get(':id/transactions')
  @ApiOperation({ summary: 'Full paginated sales history across every store in this organization, optionally date-filtered (owner only)' })
  async getOrgTransactions(
    @Param('id') id: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('organization_id') callerOrgId: string | undefined,
    @CurrentUser('role') callerRole: string | undefined,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const org = await this.orgsService.getOrganizationById(id);
    this.assertOwnerOrStaffRole(org, callerId, callerOrgId, callerRole, ['caissier', 'comptable']);
    return this.orgsService.getOrganizationTransactions(id, {
      from,
      to,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
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

  // Read-only access for any organization-staff member (magasinier/vendeur/
  // caissier/comptable — see organization-staff module) of THIS org, in
  // addition to its owner — basic org info and store list are harmless to
  // read and every staff-facing module (stock now, ventes/caisse later)
  // needs them. Never used for write endpoints, which stay owner-only.
  private assertOwnOrgOrStaff(org: { id: string; owner_id: string }, callerId: string | undefined, callerOrgId: string | undefined) {
    if (callerId && org.owner_id === callerId) return;
    if (callerOrgId && callerOrgId === org.id) return;
    throw new ForbiddenException('You do not have access to this organization');
  }

  // Owner, or an internal staff member whose role is in `allowedRoles` and who
  // belongs to this organization. Used for the staff-facing finance screens.
  private assertOwnerOrStaffRole(
    org: { id: string; owner_id: string },
    callerId: string | undefined,
    callerOrgId: string | undefined,
    callerRole: string | undefined,
    allowedRoles: string[],
  ) {
    if (callerId && org.owner_id === callerId) return;
    if (callerOrgId === org.id && callerRole && allowedRoles.includes(callerRole)) return;
    throw new ForbiddenException('You do not have access to this organization');
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
