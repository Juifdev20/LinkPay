import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

/** "+243 812 345 678", "0812345678"… — digits and spaces, an optional + in front. */
const SUPPORT_PHONE = /^\+?[\d ]{6,19}$/;
const SUPPORT_PHONE_MESSAGE = 'Numéro invalide : chiffres seulement, + au début permis (ex. +243 812 345 678).';
/** Empty or null = remove the line; anything else is checked. */
const given = (_o: unknown, v: unknown) => v !== null && v !== '';
import { PlatformSettingsService } from './platform-settings.service';
import { BankSettingsService } from './bank-settings.service';
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

  @ApiProperty({ required: false, nullable: true, description: 'Téléphone du support affiché dans l\'application (vide = pas affiché)' })
  @IsOptional()
  @ValidateIf(given)
  @Matches(SUPPORT_PHONE, { message: SUPPORT_PHONE_MESSAGE })
  support_phone?: string | null;

  @ApiProperty({ required: false, nullable: true, description: 'Numéro WhatsApp du support (vide = pas affiché)' })
  @IsOptional()
  @ValidateIf(given)
  @Matches(SUPPORT_PHONE, { message: SUPPORT_PHONE_MESSAGE })
  support_whatsapp?: string | null;

  @ApiProperty({ required: false, nullable: true, description: 'Email du support (vide = pas affiché)' })
  @IsOptional()
  @ValidateIf(given)
  @IsEmail({}, { message: 'Email invalide (ex. support@exemple.cd).' })
  @MaxLength(120)
  support_email?: string | null;
}

/** The durations offered; never "for ever": a suspension forgotten before the launch would stay. 0 = turn it back on. */
export const ADMIN_2FA_PAUSE_HOURS = [0, 1, 24, 24 * 7, 24 * 30];

class AdminTwoFactorPauseDto {
  @ApiProperty({ enum: ADMIN_2FA_PAUSE_HOURS, description: 'Suspendre pendant ce nombre d\'heures (1, 24, 168 ou 720) ; 0 = réactiver maintenant' })
  @IsIn(ADMIN_2FA_PAUSE_HOURS, { message: 'Durée invalide.' })
  pause_hours!: number;
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
  @ApiOperation({ summary: "Réglages globaux lus par l'application au lancement (protection des captures d'écran, taux indicatif, contacts du support)" })
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

  @ApiBearerAuth()
  @Put('admin/platform-settings/admin-2fa')
  @Roles('super_admin')
  @UseGuards(RolesGuard, OtpStepUpGuard)
  @RequireOtp()
  @ApiOperation({ summary: 'Suspendre pour un temps, ou réactiver, la double authentification des administrateurs (super admin)' })
  setAdminTwoFactorPause(@Body() dto: AdminTwoFactorPauseDto, @CurrentUser('id') callerId: string) {
    return this.platformSettingsService.setAdminTwoFactorPause(callerId, dto.pause_hours);
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
