import { Controller, Get, Put, Post, Body, Param, ParseUUIDPipe, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { AdminService } from './admin.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { toPage, toLimit } from '../common/utils/pagination';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { OtpStepUpGuard, RequireOtp } from '../security/otp-step-up.guard';
import { SecurityAlertsService } from '../security/security-alerts.service';
import { TwoFactorService } from '../security/two-factor.service';

class AssignRoleDto {
  @ApiProperty({ example: 'merchant' })
  @IsString()
  @Matches(/^[a-z_]{3,40}$/)
  role_slug!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  merchant_id?: string;
}

export class MerchantStatusDto {
  @ApiProperty({ enum: ['pending', 'active', 'suspended', 'rejected', 'closed'] })
  @IsIn(['pending', 'active', 'suspended', 'rejected', 'closed'])
  status!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin')
@Roles('admin', 'super_admin')
@UseGuards(RolesGuard)
export class AdminController {
  constructor(
    private adminService: AdminService,
    private audit: AuditService,
    private alerts: SecurityAlertsService,
    private twoFactor: TwoFactorService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get platform dashboard stats' })
  async getDashboard() {
    return this.adminService.getDashboardStats();
  }

  @Get('merchants')
  @ApiOperation({ summary: 'List all merchants' })
  async listMerchants(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.listMerchants({
      status,
      page: toPage(page),
      limit: toLimit(limit),
    });
  }

  @Put('merchants/:id/status')
  @ApiOperation({ summary: 'Update merchant status (approve/reject/suspend)' })
  async updateMerchantStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: MerchantStatusDto,
    @CurrentUser('id') adminId: string,
  ) {
    const result = await this.adminService.updateMerchantStatus(id, body.status, body.notes);
    await this.audit.log({ user_id: adminId, action: 'MERCHANT_STATUS_CHANGED', entity_type: 'merchant', entity_id: id, changes: { status: body.status, notes: body.notes } });
    return result;
  }

  @Get('organizations')
  @ApiOperation({ summary: 'List organizations (defaults to those awaiting validation review)' })
  async listOrganizations(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.listOrganizations({
      status,
      page: toPage(page),
      limit: toLimit(limit),
    });
  }

  @Get('users')
  @ApiOperation({ summary: 'List all users' })
  async listUsers(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.listUsers({
      page: toPage(page),
      limit: toLimit(limit),
    });
  }

  @Post('users/:userId/role')
  @Roles('super_admin')
  @UseGuards(OtpStepUpGuard)
  @RequireOtp()
  @ApiOperation({ summary: 'Assign a role to a user (Super Admin only, needs a fresh authenticator code)' })
  async assignRole(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: AssignRoleDto,
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string,
  ) {
    if (userId === adminId) {
      throw new BadRequestException('Vous ne pouvez pas modifier votre propre rôle');
    }
    const result = await this.adminService.assignRole(userId, body.role_slug, body.merchant_id);
    await this.audit.log({ user_id: adminId, action: 'ROLE_ASSIGNED', entity_type: 'user', entity_id: userId, changes: { role: body.role_slug } });
    await this.alerts.alert({
      severity: ['admin', 'super_admin'].includes(body.role_slug) ? 'critical' : 'warning',
      title: 'Rôle utilisateur modifié',
      body: `${adminEmail} a attribué le rôle « ${body.role_slug} » à l'utilisateur ${userId}.`,
      data: { user_id: userId, role: body.role_slug },
    });
    return result;
  }

  @Post('users/:userId/reset-2fa')
  @Roles('super_admin')
  @UseGuards(OtpStepUpGuard)
  @RequireOtp()
  @ApiOperation({ summary: "Remove an administrator's authenticator (lost phone). They must set it up again at next login." })
  async reset2fa(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string,
  ) {
    if (userId === adminId) {
      throw new BadRequestException('Vous ne pouvez pas réinitialiser votre propre double authentification');
    }
    await this.twoFactor.reset(userId);
    await this.audit.log({ user_id: adminId, action: 'TWO_FACTOR_RESET', entity_type: 'user', entity_id: userId });
    await this.alerts.alert({
      severity: 'critical',
      title: 'Double authentification réinitialisée',
      body: `${adminEmail} a réinitialisé la double authentification de l'utilisateur ${userId}.`,
      data: { user_id: userId },
    });
    return { success: true };
  }

  @Post('users/:userId/reset-session')
  @ApiOperation({ summary: 'Free a user\'s single-device session (e.g. they lost their phone)' })
  async resetSession(@Param('userId', ParseUUIDPipe) userId: string, @CurrentUser('id') adminId: string) {
    const result = await this.adminService.resetUserSession(userId);
    await this.audit.log({ user_id: adminId, action: 'SESSION_RESET', entity_type: 'user', entity_id: userId });
    return result;
  }
}
