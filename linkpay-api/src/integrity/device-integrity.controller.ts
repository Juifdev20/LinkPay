import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { DeviceIntegrityService } from './device-integrity.service';

export class VerifyIntegrityDto {
  @ApiProperty({ description: 'Play Integrity token produced by the app for the nonce we issued' })
  @IsString()
  @MaxLength(20000)
  token!: string;

  @ApiPropertyOptional({ type: [String], description: "What the app's own root checks saw (advisory)" })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  signals?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  rooted?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  app_version?: string;
}

@ApiTags('Device integrity')
@ApiBearerAuth()
@Controller('integrity')
export class DeviceIntegrityController {
  constructor(private integrity: DeviceIntegrityService) {}

  // Google's free quota is limited (10 000 verifications a day): keep a single device from burning it.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('nonce')
  @ApiOperation({ summary: 'One-time challenge the app must put in its Play Integrity request' })
  nonce(@CurrentUser('id') userId: string) {
    return { nonce: this.integrity.issueNonce(userId), mode: this.integrity.mode };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('verify')
  @ApiOperation({ summary: "Check the app's Play Integrity verdict and record whether this device is trusted" })
  verify(@CurrentUser('id') userId: string, @Body() dto: VerifyIntegrityDto) {
    return this.integrity.verify(userId, { token: dto.token, signals: dto.signals, rooted: dto.rooted, appVersion: dto.app_version });
  }
}
