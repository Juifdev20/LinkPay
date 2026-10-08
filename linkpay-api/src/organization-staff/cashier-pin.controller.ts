import { Controller, Get, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { CashierPinService } from './cashier-pin.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

class SetCashierPinDto {
  @ApiProperty()
  @IsString()
  @Length(4, 6)
  pin!: string;

  @ApiProperty({ required: false })
  @IsString()
  current_pin?: string;
}

class VerifyCashierPinDto {
  @ApiProperty()
  @IsString()
  @Length(4, 6)
  pin!: string;
}

/**
 * The caller's own cash-register unlock PIN — not tied to a specific
 * organization/store in the URL (a staff member's till PIN follows them,
 * resolved from their own organization_staff row via @CurrentUser('id')),
 * same "me" shape as GET /wallet/pin/status.
 */
@ApiTags('Cashier PIN')
@ApiBearerAuth()
@Controller('staff/me/pos-pin')
export class CashierPinController {
  constructor(private cashierPinService: CashierPinService) {}

  @Get('status')
  @ApiOperation({ summary: "Whether the caller has a cash-register PIN set" })
  async status(@CurrentUser('id') userId: string) {
    return { has_pin: await this.cashierPinService.hasPinSet(userId) };
  }

  @Post()
  @ApiOperation({ summary: 'Set or change the caller\'s cash-register PIN' })
  async setPin(@CurrentUser('id') userId: string, @Body() dto: SetCashierPinDto) {
    await this.cashierPinService.setPin(userId, dto.pin, dto.current_pin);
    return { success: true };
  }

  @Post('verify')
  @ApiOperation({ summary: 'Verify the cash-register PIN — used by the till lock screen' })
  async verifyPin(@CurrentUser('id') userId: string, @Body() dto: VerifyCashierPinDto) {
    await this.cashierPinService.verifyPin(userId, dto.pin);
    return { success: true };
  }
}
