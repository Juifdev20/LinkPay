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

import { OtpStepUpGuard, RequireOtp } from '../security/otp-step-up.guard';
import { SecurityAlertsService } from '../security/security-alerts.service';

@ApiTags('Commissions')
@ApiBearerAuth()
@Controller('commissions')
export class CommissionsController {
  constructor(private commissionsService: CommissionsService, private alerts: SecurityAlertsService) {}

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
  @UseGuards(RolesGuard, OtpStepUpGuard)
  @RequireOtp()
  @ApiOperation({ summary: 'Create a commission rule (Super Admin only)' })
  async createRule(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateRuleDto,
  ) {
    const rule = await this.commissionsService.createRule(dto, userId);
    await this.alerts.alert({ severity: 'warning', title: 'Commission modifiée', body: `Une nouvelle règle de commission a été créée par ${userId}.`, data: { rule } });
    return rule;
  }

  @Put('rules/:id/deactivate')
  @Roles('super_admin')
  @UseGuards(RolesGuard, OtpStepUpGuard)
  @RequireOtp()
  @ApiOperation({ summary: 'Deactivate a commission rule' })
  async deactivateRule(@Param('id') id: string, @CurrentUser('id') userId: string) {
    const rule = await this.commissionsService.deactivateRule(id);
    await this.alerts.alert({ severity: 'warning', title: 'Commission désactivée', body: `La règle ${id} a été désactivée par ${userId}.` });
    return rule;
  }
}
