import { Controller, Post, Delete, Body, Query, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, ValidateNested } from 'class-validator';
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
  @ApiProperty({ description: "The browser's push registration URL" })
  @IsString()
  endpoint!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  expirationTime?: number | null;

  @ApiProperty({ type: PushKeysDto })
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;
}

@ApiTags('Push Notifications')
@ApiBearerAuth()
@Controller('push-subscriptions')
export class PushNotificationsController {
  constructor(private pushNotificationsService: PushNotificationsService) {}

  @Post()
  @ApiOperation({ summary: "Register a browser push subscription for the current user (body = the browser's PushSubscription.toJSON())" })
  async subscribe(
    @CurrentUser('id') userId: string,
    @Body() dto: SubscribePushDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.pushNotificationsService.subscribe(userId, dto, userAgent);
  }

  @Delete()
  @ApiOperation({ summary: 'Remove a browser push subscription' })
  async unsubscribe(@CurrentUser('id') userId: string, @Query('endpoint') endpoint: string) {
    return this.pushNotificationsService.unsubscribe(userId, endpoint);
  }
}
