import { Controller, Get, Post, Body, Param, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEmail, IsIn, MaxLength } from 'class-validator';
import { OrganizationStaffService } from './organization-staff.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

const STAFF_ROLE_SLUGS = ['magasinier', 'vendeur', 'caissier', 'comptable'];

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

@ApiTags('Organization Staff')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationStaffController {
  constructor(
    private staffService: OrganizationStaffService,
    private orgsService: OrganizationsService,
  ) {}

  @Post(':id/staff')
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

  private async assertOwnOrg(orgId: string, callerId: string | undefined) {
    const org = await this.orgsService.getOrganizationById(orgId);
    if (!callerId || callerId !== org.owner_id) {
      throw new ForbiddenException('You do not manage this organization account');
    }
  }
}
