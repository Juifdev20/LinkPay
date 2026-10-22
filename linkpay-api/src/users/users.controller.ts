import { TwoFactorService } from '../security/two-factor.service';
import { MFA_REQUIRED_ROLES } from '../auth/constants';
import { AllowWithoutMfa } from '../common/decorators/allow-without-mfa.decorator';
import { Controller, Get, Put, Post, Body, UseGuards, Ip, Headers, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { IsString, IsOptional, MaxLength, Matches, IsIn, MinLength } from 'class-validator';
import { AccountDeletionService, DELETION_REASONS, type DeletionReason } from './account-deletion.service';
import { ApiPropertyOptional } from '@nestjs/swagger';

class UpdateProfileDto {
  @ApiPropertyOptional({ example: '+243812345678' })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9]{10,15}$/, { message: 'Invalid phone number format' })
  phone?: string;

  @ApiPropertyOptional({ example: 'Jean Mukendi' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  full_name?: string;

  @ApiPropertyOptional({ example: 'https://...' })
  @IsOptional()
  @IsString()
  avatar_url?: string;
}

class DeleteAccountDto {
  @ApiPropertyOptional({ description: 'Mot de passe du compte, saisi à nouveau' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;

  @ApiPropertyOptional({ enum: DELETION_REASONS })
  @IsIn(DELETION_REASONS as unknown as string[], { message: 'Choisissez la raison de votre départ.' })
  reason!: DeletionReason;

  @ApiPropertyOptional({ description: 'Ce qui vous pousse à partir (facultatif)' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService, private twoFactor: TwoFactorService, private accountDeletion: AccountDeletionService) {}

  @AllowWithoutMfa()
  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  async getMyProfile(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('merchant_id') merchantId?: string,
    @CurrentUser('acting_as_org_id') actingAsOrgId?: string,
    @CurrentUser('organization_id') organizationId?: string,
    @CurrentUser('mfa') mfa?: boolean,
  ) {
    const profile = await this.usersService.getProfile(userId, role, merchantId, actingAsOrgId, organizationId);
    // Lets the app send an admin who hasn't set up 2FA yet to the setup screen — not while the super admin suspended
    // it (migration 081); admins then see until when, as a reminder.
    if (!MFA_REQUIRED_ROLES.includes(role)) return { ...profile, mfa_verified: !!mfa };
    const pausedUntil = await this.twoFactor.adminRequirementPausedUntil();
    return { ...profile, mfa_verified: !!mfa || !!pausedUntil, admin_2fa_paused_until: pausedUntil };
  }

  @Put('me')
  @ApiOperation({ summary: 'Update current user profile' })
  async updateMyProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(userId, dto);
  }

  @Get('me/stats')
  @ApiOperation({ summary: 'Get current client payment stats' })
  async getMyStats(@CurrentUser('id') userId: string) {
    return this.usersService.getClientStats(userId);
  }

  @Get('me/roles')
  @ApiOperation({ summary: 'Get current user roles' })
  async getMyRoles(@CurrentUser('id') userId: string) {
    return this.usersService.getUserRoles(userId);
  }

  @Get('me/deletion')
  @ApiOperation({ summary: 'Suppression du compte : ce qui reste à faire avant (solde, épargne, équipe…) — vide = possible maintenant' })
  deletionCheck(@CurrentUser('id') userId: string) {
    return this.accountDeletion.blockers(userId);
  }

  @Post('me/delete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Supprimer son compte (client, marchand, patron d\'entreprise), avec la raison du départ et le mot de passe' })
  deleteMe(
    @CurrentUser('id') userId: string,
    @Body() dto: DeleteAccountDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.accountDeletion.deleteAccount(userId, dto, { ip, userAgent });
  }
}
