import { Controller, Get, Post, Put, Body, Param } from '@nestjs/common';
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

  @Get(':id')
  @ApiOperation({ summary: 'Get organization by ID' })
  async getOrg(@Param('id') id: string) {
    return this.orgsService.getOrganizationById(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update organization' })
  async updateOrg(
    @Param('id') id: string,
    @Body() updates: Record<string, any>,
  ) {
    return this.orgsService.updateOrganization(id, updates);
  }
}
