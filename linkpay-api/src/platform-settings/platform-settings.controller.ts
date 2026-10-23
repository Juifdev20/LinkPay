import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsString } from 'class-validator';
import { PlatformSettingsService } from './platform-settings.service';
import { BankSettingsService } from './bank-settings.service';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { OtpStepUpGuard, RequireOtp } from '../security/otp-step-up.guard';

class UpdatePlatformSettingsDto {
  @ApiProperty({ description: "Bloquer les captures et enregistrements d'écran dans l'application Android" })
  @IsBoolean()
  screenshot_protection!: boolean;
}

class UpdateBanksDto {
  @ApiProperty({ type: [String], description: 'Banques proposées pour les retraits (noms du catalogue)' })
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  banks!: string[];
}

@ApiTags('Platform settings')
@Controller()
export class PlatformSettingsController {
  constructor(private platformSettingsService: PlatformSettingsService, private bankSettings: BankSettingsService) {}

  // Public: read before login too — the login and PIN screens are protected.
  @Public()
  @Get('platform/settings')
  @ApiOperation({ summary: "Réglages globaux lus par l'application au lancement (protection des captures d'écran)" })
  getPublic() {
    return this.platformSettingsService.getPublicSettings();
  }

  @ApiBearerAuth()
  @Get('admin/platform-settings')
  @Roles('super_admin')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Réglages globaux complets (super admin)' })
  get() {
    return this.platformSettingsService.getSettings();
  }

  @ApiBearerAuth()
  @Put('admin/platform-settings')
  @Roles('super_admin')
  @UseGuards(RolesGuard, OtpStepUpGuard)
  @RequireOtp()
  @ApiOperation({ summary: 'Modifier les réglages globaux (super admin)' })
  update(@Body() dto: UpdatePlatformSettingsDto, @CurrentUser('id') callerId: string) {
    return this.platformSettingsService.update(callerId, dto);
  }

  /** Every signed-in user: the banks offered for a withdrawal or a settlement account (chosen by the super admin). */
  @ApiBearerAuth()
  @Get('platform/banks')
  @ApiOperation({ summary: 'Banques proposées pour les retraits' })
  async banks() {
    return { banks: await this.bankSettings.enabledBanks() };
  }

  @ApiBearerAuth()
  @Get('admin/banks')
  @Roles('super_admin')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Banques du catalogue, activées ou non (super admin)' })
  adminBanks() {
    return this.bankSettings.adminView();
  }

  @ApiBearerAuth()
  @Put('admin/banks')
  @Roles('super_admin')
  @UseGuards(RolesGuard, OtpStepUpGuard)
  @RequireOtp()
  @ApiOperation({ summary: 'Choisir les banques proposées pour les retraits (super admin)' })
  setBanks(@Body() dto: UpdateBanksDto, @CurrentUser('id') callerId: string) {
    return this.bankSettings.setEnabled(callerId, dto.banks);
  }
}
