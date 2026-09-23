import { Controller, Get, Put, Post, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsInt, IsIn, IsString, Min, Max, MaxLength, Length } from 'class-validator';
import { SavingsService } from './savings.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

class UpdateSavingsSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  round_up_enabled?: boolean;

  @ApiPropertyOptional({ description: 'Cents, in the pot\'s own currency — e.g. 50000 for 500 CDF, or 50 for $0.50', minimum: 1, maximum: 1000000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000)
  round_up_increment_cents?: number;

  @ApiPropertyOptional({ example: 'Vélo' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  goal_name?: string;

  @ApiPropertyOptional({ description: "Cents, in the pot's own currency" })
  @IsOptional()
  @IsInt()
  @Min(1)
  goal_amount_cents?: number;
}

class WithdrawSavingsDto {
  @ApiProperty({ description: "Cents, in the pot's own currency" })
  @IsInt()
  @Min(1)
  amount_cents!: number;

  @ApiProperty()
  @IsString()
  @Length(4, 4)
  pin!: string;
}

@ApiTags('Savings')
@ApiBearerAuth()
@Controller('savings')
export class SavingsController {
  constructor(private savingsService: SavingsService) {}

  @Get()
  @ApiOperation({ summary: "Get the caller's savings pots for both currencies — settings, computed balance, recent entries" })
  async getMine(@CurrentUser('id') userId: string) {
    return this.savingsService.getMyPot(userId);
  }

  @Put('settings/:currency')
  @ApiOperation({ summary: "Update round-up/goal settings for the caller's own pot, for one currency (CDF or USD)" })
  async updateSettings(
    @CurrentUser('id') userId: string,
    @Param('currency') currency: string,
    @Body() dto: UpdateSavingsSettingsDto,
  ) {
    return this.savingsService.updateSettings(userId, currency, dto);
  }

  @Post(':currency/withdraw')
  @ApiOperation({ summary: 'Move money from the pot back to the main wallet, in the same currency — free anytime, PIN required' })
  async withdraw(
    @CurrentUser('id') userId: string,
    @Param('currency') currency: string,
    @Body() dto: WithdrawSavingsDto,
  ) {
    return this.savingsService.withdraw(userId, currency, dto.amount_cents, dto.pin);
  }
}
