import { Controller, Get, Post, Put, Body, Param, ForbiddenException, BadRequestException, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEmail, IsIn, IsUUID, MaxLength } from 'class-validator';
import { OrganizationStaffService, STAFF_ROLE_SLUGS, StaffManagerScope, normalizeStaffRole } from './organization-staff.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AppCodeConfirmGuard, RequireAppCode } from '../common/guards/app-code-confirm.guard';
import { RequireSubscription } from '../subscriptions/subscription.guard';


class CreateStaffDto {
  @ApiProperty({ example: 'Mukendi' })
  @IsString()
  @MaxLength(255)
  nom!: string;

  @ApiPropertyOptional({ example: 'Kalala' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  postnom?: string;

  @ApiProperty({ example: 'Jean' })
  @IsString()
  @MaxLength(255)
  prenom!: string;

  @ApiPropertyOptional({ example: '+243812345678' })
  @IsOptional()
  @IsString()
  telephone?: string;

  @ApiProperty({ example: 'jean.mukendi@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: STAFF_ROLE_SLUGS })
  @IsIn(STAFF_ROLE_SLUGS)
  role_slug!: string;

  @ApiPropertyOptional({ description: "The station (store of the organization) this person works in — required from the owner; a station manager's own station otherwise" })
  @IsOptional()
  @IsUUID()
  merchant_id?: string;
}

class ChangeStationDto {
  @ApiProperty()
  @IsUUID()
  merchant_id!: string;
}

class ChangeRoleDto {
  @ApiProperty({ enum: STAFF_ROLE_SLUGS })
  @IsIn(STAFF_ROLE_SLUGS)
  role_slug!: string;
}

type Caller = { id: string; role?: string; organization_id?: string };

@ApiTags('Organization Staff')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationStaffController {
  constructor(
    private staffService: OrganizationStaffService,
    private orgsService: OrganizationsService,
  ) {}

  @Post(':id/staff')
  // Only ADDING people needs the subscription: removing access or changing a role must always work.
  @RequireSubscription('org')
  @ApiOperation({ summary: 'Create an internal user in a station (owner; a station manager in their own station, never another manager)' })
  async createStaff(
    @Param('id') id: string,
    @Body() dto: CreateStaffDto,
    @CurrentUser() caller: Caller,
  ) {
    const scope = await this.managerScope(id, caller);
    dto.role_slug = normalizeStaffRole(dto.role_slug);
    if (scope.station) {
      if (dto.role_slug === 'gerant') throw new ForbiddenException("Seul le responsable de l'entreprise nomme les gérants");
      dto.merchant_id = scope.station;
    }
    if (!dto.merchant_id) throw new BadRequestException('Choisissez la station de cet utilisateur');
    return this.staffService.createStaff(id, caller.id, { ...dto, merchant_id: dto.merchant_id });
  }

  @Get(':id/staff')
  @ApiOperation({ summary: "List internal users (owner: every station; a station manager: their station)" })
  async listStaff(@Param('id') id: string, @CurrentUser() caller: Caller) {
    const scope = await this.managerScope(id, caller);
    return this.staffService.listStaff(id, scope.station);
  }

  @Get(':id/staff/:staffId/reprint')
  @ApiOperation({ summary: 'Re-fetch a staff member\'s temporary password for re-printing (owner only, once-used-only)' })
  async reprintStaffCredential(
    @Param('id') id: string,
    @Param('staffId') staffId: string,
    @CurrentUser() caller: Caller,
  ) {
    await this.assertCanManage(id, staffId, caller);
    return this.staffService.getStaffCredential(id, staffId);
  }

  @Post(':id/staff/:staffId/reset-password')
  @ApiOperation({ summary: 'Reset a staff member\'s password to a new temporary one (owner only) — also frees their session slot' })
  async resetStaffPassword(
    @Param('id') id: string,
    @Param('staffId') staffId: string,
    @CurrentUser() caller: Caller,
  ) {
    await this.assertCanManage(id, staffId, caller);
    return this.staffService.resetStaffPassword(id, staffId);
  }

  // The three actions below change who may do what: the patron confirms with
  // their own access code (AppCodeConfirmGuard), checked by the API.
  @UseGuards(AppCodeConfirmGuard)
  @RequireAppCode()
  @Put(':id/staff/:staffId/role')
  @ApiOperation({ summary: "Change an employee's role (owner only). Their sessions are cut so they log in again with the new role." })
  async changeStaffRole(
    @Param('id') id: string,
    @Param('staffId') staffId: string,
    @Body() dto: ChangeRoleDto,
    @CurrentUser() caller: Caller,
  ) {
    const scope = await this.assertCanManage(id, staffId, caller);
    dto.role_slug = normalizeStaffRole(dto.role_slug);
    if (scope.station && dto.role_slug === 'gerant') throw new ForbiddenException("Seul le responsable de l'entreprise nomme les gérants");
    return this.staffService.changeStaffRole(id, staffId, caller.id, dto.role_slug);
  }

  @UseGuards(AppCodeConfirmGuard)
  @RequireAppCode()
  @Put(':id/staff/:staffId/station')
  @ApiOperation({ summary: 'Move an employee to another station (owner only). Their sessions are cut so they log in again in the new station.' })
  async changeStaffStation(
    @Param('id') id: string,
    @Param('staffId') staffId: string,
    @Body() dto: ChangeStationDto,
    @CurrentUser('id') callerId: string,
  ) {
    await this.assertOwnOrg(id, callerId);
    return this.staffService.changeStaffStation(id, staffId, callerId, dto.merchant_id);
  }

  @UseGuards(AppCodeConfirmGuard)
  @RequireAppCode()
  @Post(':id/staff/:staffId/deactivate')
  @ApiOperation({ summary: 'Remove an employee\'s access (owner only): login blocked, sessions cut, history kept' })
  async deactivateStaff(
    @Param('id') id: string,
    @Param('staffId') staffId: string,
    @CurrentUser() caller: Caller,
  ) {
    await this.assertCanManage(id, staffId, caller);
    return this.staffService.deactivateStaff(id, staffId, caller.id);
  }

  @UseGuards(AppCodeConfirmGuard)
  @RequireAppCode()
  @Post(':id/staff/:staffId/reactivate')
  @ApiOperation({ summary: 'Give an employee their access back (owner only): new temporary password' })
  async reactivateStaff(
    @Param('id') id: string,
    @Param('staffId') staffId: string,
    @CurrentUser() caller: Caller,
  ) {
    await this.assertCanManage(id, staffId, caller);
    return this.staffService.reactivateStaff(id, staffId, caller.id);
  }

  /** The owner manages every station; a station manager of this organization, their own station only. */
  private async managerScope(orgId: string, caller: Caller): Promise<StaffManagerScope> {
    const org = await this.orgsService.getOrganizationById(orgId);
    if (caller.id && caller.id === org.owner_id) return { station: null };
    if (caller.role === 'gerant' && caller.organization_id === orgId) {
      return { station: await this.orgsService.staffStation(caller.id, orgId) };
    }
    throw new ForbiddenException('You do not manage this organization account');
  }

  private async assertCanManage(orgId: string, staffId: string, caller: Caller): Promise<StaffManagerScope> {
    const scope = await this.managerScope(orgId, caller);
    await this.staffService.assertCanManage(orgId, staffId, scope);
    return scope;
  }

  private async assertOwnOrg(orgId: string, callerId: string | undefined) {
    const org = await this.orgsService.getOrganizationById(orgId);
    if (!callerId || callerId !== org.owner_id) {
      throw new ForbiddenException('You do not manage this organization account');
    }
  }
}
