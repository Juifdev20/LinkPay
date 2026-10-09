import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AllowWithoutMfa } from '../common/decorators/allow-without-mfa.decorator';
import { AppCodeService } from './app-code.service';

const CODE = /^\d{6}$/;
const MSG = { message: 'Le code doit comporter exactement 6 chiffres.' };

class CreateAppCodeDto {
  @ApiProperty({ example: '482915' }) @Matches(CODE, MSG) code!: string;
  @ApiProperty({ example: '482915' }) @Matches(CODE, MSG) confirm_code!: string;
}
class VerifyAppCodeDto {
  @ApiProperty({ example: '482915' }) @IsString() @MaxLength(12) code!: string;
}
class ChangeAppCodeDto {
  @ApiProperty() @IsString() @MaxLength(12) current_code!: string;
  @ApiProperty() @Matches(CODE, MSG) code!: string;
  @ApiProperty() @Matches(CODE, MSG) confirm_code!: string;
}
class ResetAppCodeDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(128) password!: string;
}

@ApiTags('Access code')
@ApiBearerAuth()
@AllowWithoutMfa()
@Controller('auth/app-code')
export class AppCodeController {
  constructor(private appCode: AppCodeService) {}

  @Get('status')
  @ApiOperation({ summary: 'Has this account chosen an access code?' })
  async status(@CurrentUser('id') userId: string) {
    return { has_code: await this.appCode.hasCode(userId) };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Choose the access code (first time)' })
  async create(@CurrentUser('id') userId: string, @Body() dto: CreateAppCodeDto) {
    await this.appCode.create(userId, dto.code, dto.confirm_code);
    return { success: true };
  }

  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unlock the app: check the access code (5 tries, then a 15-minute lock)' })
  async verify(@CurrentUser('id') userId: string, @Body() dto: VerifyAppCodeDto) {
    await this.appCode.verify(userId, dto.code);
    return { success: true };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Put()
  @ApiOperation({ summary: 'Change the access code: current code, then the new one twice' })
  async change(@CurrentUser('id') userId: string, @Body() dto: ChangeAppCodeDto) {
    await this.appCode.change(userId, dto.current_code, dto.code, dto.confirm_code);
    return { success: true };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Forgot the code: confirm with the account password, then choose a new code' })
  async reset(@CurrentUser('id') userId: string, @Body() dto: ResetAppCodeDto) {
    await this.appCode.resetWithPassword(userId, dto.password);
    return { success: true };
  }
}
