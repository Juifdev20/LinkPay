import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MerchantsService } from './merchants.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { IsString, IsOptional, MaxLength, IsEmail, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class AddMerchantUserDto {
  @ApiProperty({ example: 'caissier@example.com' })
  @IsEmail()
  email!: string;
}

class CreateMerchantDto {
  @ApiProperty({ example: 'Boutique Mukendi' })
  @IsString()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  legal_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ default: 'CDF', enum: ['CDF', 'USD'], description: 'Default currency for new payment links from this shop' })
  @IsOptional()
  @IsIn(['CDF', 'USD'])
  default_currency?: string;
}

@ApiTags('Merchants')
@ApiBearerAuth()
@Controller('merchants')
export class MerchantsController {
  constructor(private merchantsService: MerchantsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a merchant account' })
  async createMerchant(
    @CurrentUser('id') userId: string,
    @CurrentUser('email') email: string,
    @Body() dto: CreateMerchantDto,
  ) {
    return this.merchantsService.createMerchant(userId, email, dto);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user merchant account' })
  async getMyMerchant(@CurrentUser('id') userId: string) {
    return this.merchantsService.getMerchantByOwner(userId);
  }

  @Get('me/stats')
  @ApiOperation({ summary: 'Get current user merchant dashboard stats' })
  async getMyMerchantStats(@CurrentUser('id') userId: string) {
    const merchant = await this.merchantsService.getMerchantByOwner(userId);
    return this.merchantsService.getMerchantStats(merchant.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get merchant by ID' })
  async getMerchant(@Param('id') id: string) {
    return this.merchantsService.getMerchantById(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update merchant' })
  async updateMerchant(
    @Param('id') id: string,
    @Body() updates: Record<string, any>,
  ) {
    return this.merchantsService.updateMerchant(id, updates);
  }

  @Get(':id/stats')
  @ApiOperation({ summary: 'Get merchant dashboard stats' })
  async getMerchantStats(@Param('id') id: string) {
    return this.merchantsService.getMerchantStats(id);
  }

  @Get(':id/users')
  @Roles('merchant')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Get merchant team members (owner only)' })
  async getMerchantUsers(
    @Param('id') id: string,
    @CurrentUser('merchant_id') callerMerchantId: string,
  ) {
    this.assertOwnMerchant(id, callerMerchantId);
    return this.merchantsService.getMerchantUsers(id);
  }

  @Post(':id/users')
  @Roles('merchant')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Invite an existing LinkPay user as cashier (owner only)' })
  async addMerchantUser(
    @Param('id') id: string,
    @CurrentUser('merchant_id') callerMerchantId: string,
    @Body() dto: AddMerchantUserDto,
  ) {
    this.assertOwnMerchant(id, callerMerchantId);
    return this.merchantsService.addMerchantUser(id, { email: dto.email });
  }

  @Delete(':id/users/:userId')
  @Roles('merchant')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Remove a cashier from the merchant team (owner only)' })
  async removeMerchantUser(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser('merchant_id') callerMerchantId: string,
  ) {
    this.assertOwnMerchant(id, callerMerchantId);
    return this.merchantsService.removeMerchantUser(id, userId);
  }

  private assertOwnMerchant(paramMerchantId: string, callerMerchantId: string | undefined) {
    if (!callerMerchantId || callerMerchantId !== paramMerchantId) {
      throw new ForbiddenException('You do not manage this merchant account');
    }
  }
}
