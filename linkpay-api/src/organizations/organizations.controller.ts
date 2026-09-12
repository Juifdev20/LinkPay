import { Controller, Get, Post, Put, Body, Param, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { IsString, IsOptional, MaxLength, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

  private isAdmin(role: string | undefined): boolean {
    return role === 'admin' || role === 'super_admin';
  }

  private assertOwnOrgOrAdmin(ownerId: string | undefined, callerId: string | undefined, callerRole: string | undefined) {
    if (this.isAdmin(callerRole)) return;
    if (!callerId || callerId !== ownerId) {
      throw new ForbiddenException('You do not manage this organization account');
    }
  }
}
