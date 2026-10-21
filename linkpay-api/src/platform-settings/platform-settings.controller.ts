import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import { PlatformSettingsService } from './platform-settings.service';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { OtpStepUpGuard, RequireOtp } from '../security/otp-step-up.guard';

class UpdatePlatformSettingsDto {
  @ApiProperty({ required: false, description: "Bloquer les captures et enregistrements d'écran dans l'application Android" })
  @IsOptional()
  @IsBoolean()
  screenshot_protection?: boolean;

  @ApiProperty({ required: false, nullable: true, description: 'Taux indicatif : combien de CDF pour 1 USD (affichage seulement ; null = aucun)' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(999999)
  cdf_per_usd?: number | null;
}

@ApiTags('Platform settings')
@Controller()
export class PlatformSettingsController {
  constructor(private platformSettingsService: PlatformSettingsService) {}

  // Public: read before login too — the login and PIN screens are protected.
  @Public()
  @Get('platform/settings')
  @ApiOperation({ summary: "Réglages globaux lus par l'application au lancement (protection des captures d'écran, taux indicatif)" })
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
}
