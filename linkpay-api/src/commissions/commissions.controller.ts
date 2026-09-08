import { Controller, Get, Post, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CommissionsService } from './commissions.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { IsString, IsOptional, IsNumber, IsBoolean, IsIn, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class CreateRuleDto {
  @ApiProperty({ example: 'Standard 2.5%' })
  @IsString()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: '0.0250', description: 'Percent as decimal (2.5% = 0.0250)' })
  @IsString()
  percent!: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  fixed_cents?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  min_cents?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  max_cents?: number;

  @ApiPropertyOptional({ default: 'all' })
  @IsOptional()
  @IsString()
  applies_to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  target_id?: string;

  @ApiPropertyOptional({ default: 'CDF', enum: ['CDF', 'USD'] })
  @IsOptional()
  @IsIn(['CDF', 'USD'])
  currency?: string;
}

@ApiTags('Commissions')
@ApiBearerAuth()
@Controller('commissions')
export class CommissionsController {
  constructor(private commissionsService: CommissionsService) {}

  @Get('rules')
  @ApiOperation({ summary: 'List commission rules' })
  async listRules(
    @Query('applies_to') appliesTo?: string,
    @Query('active_only') activeOnly?: string,
  ) {
    return this.commissionsService.listRules({
      applies_to: appliesTo,
      active_only: activeOnly === 'true',
    });
  }

  @Post('rules')
  @Roles('super_admin')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Create a commission rule (Super Admin only)' })
  async createRule(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateRuleDto,
  ) {
    return this.commissionsService.createRule(dto, userId);
  }

  @Put('rules/:id/deactivate')
  @Roles('super_admin')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Deactivate a commission rule' })
  async deactivateRule(@Param('id') id: string) {
    return this.commissionsService.deactivateRule(id);
  }
}
