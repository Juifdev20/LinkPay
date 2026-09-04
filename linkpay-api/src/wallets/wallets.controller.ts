import { Controller, Get, Post, Body, Headers, Query, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min } from 'class-validator';
import { WalletsService } from './wallets.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

class CreateTopupDto {
  @ApiProperty({ example: 50000, description: 'Amount in cents (e.g. 50000 = 500.00 CDF)' })
  @IsNumber()
  @Min(100)
  amount_cents!: number;
}

@ApiTags('Wallet')
@ApiBearerAuth()
@Controller('wallet')
export class WalletsController {
  constructor(private walletsService: WalletsService) {}

  @Get()
  @ApiOperation({ summary: "Get the current user's wallet and balance" })
  async getMyWallet(@CurrentUser('id') userId: string) {
    return this.walletsService.getMyWallet(userId);
  }

  @Get('transactions')
  @ApiOperation({ summary: "Get the current user's wallet ledger history" })
  async getMyLedger(
    @CurrentUser('id') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.walletsService.getMyLedger(userId, {
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
    });
  }

  @Post('topups')
  @ApiOperation({ summary: 'Initiate a wallet top-up (recharge)' })
  async createTopup(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateTopupDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    return this.walletsService.initiateTopup(userId, dto.amount_cents, idempotencyKey);
  }
}
