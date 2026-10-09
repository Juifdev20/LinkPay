import { Controller, Get, Post, Put, Body, Param, ForbiddenException, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEmail, IsIn, MaxLength } from 'class-validator';
import { OrganizationStaffService, STAFF_ROLE_SLUGS } from './organization-staff.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AppCodeConfirmGuard, RequireAppCode } from '../common/guards/app-code-confirm.guard';
import { RequireLicense } from '../licenses/license.guard';


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
}

class ChangeRoleDto {
  @ApiProperty({ enum: STAFF_ROLE_SLUGS })
  @IsIn(STAFF_ROLE_SLUGS)
  role_slug!: string;
}

@ApiTags('Organization Staff')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationStaffController {
  constructor(
    private staffService: OrganizationStaffService,
    private orgsService: OrganizationsService,
  ) {}

  @Post(':id/staff')
  // Only ADDING people needs the licence: removing access or changing a role must always work.
  @RequireLicense('staff', 'org')
  @ApiOperation({ summary: 'Create an internal user for this organization (owner only)' })
  async createStaff(
    @Param('id') id: string,
    @Body() dto: CreateStaffDto,
    @CurrentUser('id') callerId: string,
  ) {
    await this.assertOwnOrg(id, callerId);
    return this.staffService.createStaff(id, callerId, dto);
  }

  @Get(':id/staff')
  @ApiOperation({ summary: "List this organization's internal users, grouped by role (owner only)" })
  async listStaff(@Param('id') id: string, @CurrentUser('id') callerId: string) {
    await this.assertOwnOrg(id, callerId);
    return this.staffService.listStaff(id);
  }

  @Get(':id/staff/:staffId/reprint')
  @ApiOperation({ summary: 'Re-fetch a staff member\'s temporary password for re-printing (owner only, once-used-only)' })
  async reprintStaffCredential(
    @Param('id') id: string,
    @Param('staffId') staffId: string,
    @CurrentUser('id') callerId: string,
  ) {
    await this.assertOwnOrg(id, callerId);
    return this.staffService.getStaffCredential(id, staffId);
  }

  @Post(':id/staff/:staffId/reset-password')
  @ApiOperation({ summary: 'Reset a staff member\'s password to a new temporary one (owner only) — also frees their session slot' })
  async resetStaffPassword(
    @Param('id') id: string,
    @Param('staffId') staffId: string,
    @CurrentUser('id') callerId: string,
  ) {
    await this.assertOwnOrg(id, callerId);
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
    @CurrentUser('id') callerId: string,
  ) {
    await this.assertOwnOrg(id, callerId);
    return this.staffService.changeStaffRole(id, staffId, callerId, dto.role_slug);
  }

  @UseGuards(AppCodeConfirmGuard)
  @RequireAppCode()
  @Post(':id/staff/:staffId/deactivate')
  @ApiOperation({ summary: 'Remove an employee\'s access (owner only): login blocked, sessions cut, history kept' })
  async deactivateStaff(
    @Param('id') id: string,
    @Param('staffId') staffId: string,
    @CurrentUser('id') callerId: string,
  ) {
    await this.assertOwnOrg(id, callerId);
    return this.staffService.deactivateStaff(id, staffId, callerId);
  }

  @UseGuards(AppCodeConfirmGuard)
  @RequireAppCode()
  @Post(':id/staff/:staffId/reactivate')
  @ApiOperation({ summary: 'Give an employee their access back (owner only): new temporary password' })
  async reactivateStaff(
    @Param('id') id: string,
    @Param('staffId') staffId: string,
    @CurrentUser('id') callerId: string,
  ) {
    await this.assertOwnOrg(id, callerId);
    return this.staffService.reactivateStaff(id, staffId, callerId);
  }

  private async assertOwnOrg(orgId: string, callerId: string | undefined) {
    const org = await this.orgsService.getOrganizationById(orgId);
    if (!callerId || callerId !== org.owner_id) {
      throw new ForbiddenException('You do not manage this organization account');
    }
  }
}
