import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { PlatformSettingsService } from './platform-settings.service';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

class UpdatePlatformSettingsDto {
  @ApiProperty({ description: "Bloquer les captures et enregistrements d'écran dans l'application Android" })
  @IsBoolean()
  screenshot_protection!: boolean;
}

@ApiTags('Platform settings')
@Controller()
export class PlatformSettingsController {
  constructor(private platformSettingsService: PlatformSettingsService) {}

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
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Modifier les réglages globaux (super admin)' })
  update(@Body() dto: UpdatePlatformSettingsDto, @CurrentUser('id') callerId: string) {
    return this.platformSettingsService.update(callerId, dto);
  }
}
