import { Controller, Get, Put, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsInt, IsString, Min, Max, MaxLength, Length } from 'class-validator';
import { SavingsService } from './savings.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

class UpdateSavingsSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  round_up_enabled?: boolean;

  @ApiPropertyOptional({ description: 'CDF cents — e.g. 50000 for a 500 CDF increment', minimum: 10000, maximum: 100000 })
  @IsOptional()
  @IsInt()
  @Min(10000)
  @Max(100000)
  round_up_increment_cents?: number;

  @ApiPropertyOptional({ example: 'Vélo' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  goal_name?: string;

  @ApiPropertyOptional({ description: 'CDF cents' })
  @IsOptional()
  @IsInt()
  @Min(1)
  goal_amount_cents?: number;
}

class WithdrawSavingsDto {
  @ApiProperty({ description: 'CDF cents' })
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
  @ApiOperation({ summary: "Get the caller's savings pot — settings, computed balance, recent entries" })
  async getMine(@CurrentUser('id') userId: string) {
    return this.savingsService.getMyPot(userId);
  }

  @Put('settings')
  @ApiOperation({ summary: 'Update round-up/goal settings for the caller\'s own pot' })
  async updateSettings(@CurrentUser('id') userId: string, @Body() dto: UpdateSavingsSettingsDto) {
    return this.savingsService.updateSettings(userId, dto);
  }

  @Post('withdraw')
  @ApiOperation({ summary: 'Move money from the pot back to the main wallet — free anytime, PIN required' })
  async withdraw(@CurrentUser('id') userId: string, @Body() dto: WithdrawSavingsDto) {
    return this.savingsService.withdraw(userId, dto.amount_cents, dto.pin);
  }
}
