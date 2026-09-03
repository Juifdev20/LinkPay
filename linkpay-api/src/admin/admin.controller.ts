import { Controller, Get, Put, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin')
@Roles('admin', 'super_admin')
@UseGuards(RolesGuard)
export class AdminController {
  constructor(private adminService: AdminService) {}

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
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
    });
  }

  @Put('merchants/:id/status')
  @ApiOperation({ summary: 'Update merchant status (approve/reject/suspend)' })
  async updateMerchantStatus(
    @Param('id') id: string,
    @Body() body: { status: string; notes?: string },
  ) {
    return this.adminService.updateMerchantStatus(id, body.status, body.notes);
  }

  @Get('users')
  @ApiOperation({ summary: 'List all users' })
  async listUsers(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.listUsers({
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
    });
  }

  @Post('users/:userId/role')
  @Roles('super_admin')
  @ApiOperation({ summary: 'Assign a role to a user (Super Admin only)' })
  async assignRole(
    @Param('userId') userId: string,
    @Body() body: { role_slug: string; merchant_id?: string },
  ) {
    return this.adminService.assignRole(userId, body.role_slug, body.merchant_id);
  }

  @Post('users/:userId/reset-session')
  @ApiOperation({ summary: 'Free a user\'s single-device session (e.g. they lost their phone)' })
  async resetSession(@Param('userId') userId: string) {
    return this.adminService.resetUserSession(userId);
  }
}
