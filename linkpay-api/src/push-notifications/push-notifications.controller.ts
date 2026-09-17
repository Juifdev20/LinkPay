import { Controller, Post, Delete, Body, Query, Headers, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsIn, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PushNotificationsService } from './push-notifications.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

class PushKeysDto {
  @ApiProperty()
  @IsString()
  p256dh!: string;

  @ApiProperty()
  @IsString()
  auth!: string;
}

class SubscribePushDto {
  @ApiProperty({ required: false, enum: ['web', 'android'], description: "Defaults to 'web' — the Capacitor Android app sends 'android' with fcmToken instead of endpoint/keys" })
  @IsOptional()
  @IsIn(['web', 'android'])
  platform?: 'web' | 'android';

  @ApiProperty({ required: false, description: "The browser's push registration URL (web only)" })
  @IsOptional()
  @IsString()
  endpoint?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  expirationTime?: number | null;

  @ApiProperty({ type: PushKeysDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys?: PushKeysDto;

  @ApiProperty({ required: false, description: 'FCM registration token (android only)' })
  @IsOptional()
  @IsString()
  fcmToken?: string;
}

@ApiTags('Push Notifications')
@ApiBearerAuth()
@Controller('push-subscriptions')
export class PushNotificationsController {
  constructor(private pushNotificationsService: PushNotificationsService) {}

  @Post()
  @ApiOperation({ summary: "Register a push subscription for the current user — either a browser PushSubscription (default) or an Android FCM token (platform: 'android')" })
  async subscribe(
    @CurrentUser('id') userId: string,
    @Body() dto: SubscribePushDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    const platform = dto.platform || 'web';
    if (platform === 'android') {
      if (!dto.fcmToken) throw new BadRequestException('fcmToken is required when platform is "android"');
      return this.pushNotificationsService.subscribeFcm(userId, dto.fcmToken, userAgent);
    }
    if (!dto.endpoint || !dto.keys) throw new BadRequestException('endpoint and keys are required for web push subscriptions');
    return this.pushNotificationsService.subscribe(userId, { endpoint: dto.endpoint, keys: dto.keys }, userAgent);
  }

  @Delete()
  @ApiOperation({ summary: 'Remove a push subscription, by web endpoint or FCM token' })
  async unsubscribe(
    @CurrentUser('id') userId: string,
    @Query('endpoint') endpoint?: string,
    @Query('fcmToken') fcmToken?: string,
  ) {
    if (fcmToken) return this.pushNotificationsService.unsubscribeFcm(userId, fcmToken);
    return this.pushNotificationsService.unsubscribe(userId, endpoint!);
  }
}
