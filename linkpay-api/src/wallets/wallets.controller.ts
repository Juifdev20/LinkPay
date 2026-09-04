import { Controller, Get, Post, Body, Headers, Query, Param, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, Min, IsString, IsOptional, IsIn, IsObject, Length } from 'class-validator';
import { WalletsService } from './wallets.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

class CreateTopupDto {
  @ApiProperty({ example: 50000, description: 'Amount in cents (e.g. 50000 = 500.00 CDF)' })
  @IsNumber()
  @Min(100)
  amount_cents!: number;

  @ApiProperty({ enum: ['CDF', 'USD'] })
  @IsIn(['CDF', 'USD'])
  currency!: string;

  @ApiPropertyOptional({ enum: ['mobile_money', 'card'] })
  @IsOptional()
  @IsIn(['mobile_money', 'card'])
  payment_method?: string;

  @ApiPropertyOptional({ example: 'airtel' })
  @IsOptional()
  @IsString()
  mobile_money_operator?: string;

  @ApiPropertyOptional({ example: '+243900000000', description: 'Mobile Money number to push the withdrawal request to — required when payment_method is mobile_money' })
  @IsOptional()
  @IsString()
  mobile_money_phone?: string;
}

class SetPinDto {
  @ApiProperty({ example: '1234', description: '4-6 digit transaction PIN' })
  @IsString()
  @Length(4, 6)
  pin!: string;

  @ApiPropertyOptional({ description: 'Required when changing an existing PIN' })
  @IsOptional()
  @IsString()
  current_pin?: string;
}

class TransferDto {
  @ApiProperty({ example: 'LP-00001234' })
  @IsString()
  recipient_wallet_number!: string;

  @ApiProperty({ example: 20000 })
  @IsNumber()
  @Min(1)
  amount_cents!: number;

  @ApiProperty({ enum: ['CDF', 'USD'] })
  @IsIn(['CDF', 'USD'])
  currency!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Transaction PIN' })
  @IsString()
  pin!: string;
}

class WithdrawalDto {
  @ApiProperty({ example: 50000 })
  @IsNumber()
  @Min(1)
  amount_cents!: number;

  @ApiProperty({ enum: ['CDF', 'USD'] })
  @IsIn(['CDF', 'USD'])
  currency!: string;

  @ApiProperty({ enum: ['mobile_money', 'bank'] })
  @IsIn(['mobile_money', 'bank'])
  channel!: 'mobile_money' | 'bank';

  @ApiProperty({ example: { operator: 'airtel', phone: '+243900000000' } })
  @IsObject()
  destination!: Record<string, any>;

  @ApiProperty({ description: 'Transaction PIN' })
  @IsString()
  pin!: string;
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
    return this.walletsService.initiateTopup(
      userId,
      dto.amount_cents,
      dto.currency,
      idempotencyKey,
      dto.payment_method,
      dto.mobile_money_operator,
      dto.mobile_money_phone,
    );
  }

  @Get('fees/:opType')
  @ApiOperation({ summary: 'Preview the fee for an operation before confirming (never hidden from the user)' })
  async previewFee(
    @Param('opType') opType: string,
    @Query('amount_cents') amountCents: string,
    @Query('currency') currency: string,
  ) {
    const amount = parseInt(amountCents, 10) || 0;
    if (!['TRANSFER', 'WITHDRAWAL', 'WALLET_PAYMENT'].includes(opType)) {
      throw new BadRequestException('Invalid operation type');
    }
    if (!['CDF', 'USD'].includes(currency)) {
      throw new BadRequestException('Invalid currency');
    }
    return this.walletsService.previewFee(opType as any, amount, currency);
  }

  @Get('pin/status')
  @ApiOperation({ summary: 'Whether the current user has a transaction PIN set' })
  async getPinStatus(@CurrentUser('id') userId: string) {
    return this.walletsService.getPinStatus(userId);
  }

  @Post('pin')
  @ApiOperation({ summary: 'Set or change the transaction PIN' })
  async setPin(@CurrentUser('id') userId: string, @Body() dto: SetPinDto) {
    return this.walletsService.setPin(userId, dto.pin, dto.current_pin);
  }

  @Get('lookup/:number')
  @ApiOperation({ summary: 'Look up a recipient/merchant by LinkPay number (masked display name only)' })
  async lookup(@Param('number') number: string) {
    return this.walletsService.lookupWallet(number);
  }

  @Post('transfers')
  @ApiOperation({ summary: 'Send money to another LinkPay user by wallet number' })
  async createTransfer(
    @CurrentUser('id') userId: string,
    @Body() dto: TransferDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    return this.walletsService.transfer(userId, dto, idempotencyKey);
  }

  @Get('transfers')
  @ApiOperation({ summary: "Get the current user's sent/received transfers" })
  async getMyTransfers(
    @CurrentUser('id') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.walletsService.getMyTransfers(userId, {
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
    });
  }

  @Post('withdrawals')
  @ApiOperation({ summary: 'Request a withdrawal to Mobile Money or bank' })
  async createWithdrawal(
    @CurrentUser('id') userId: string,
    @Body() dto: WithdrawalDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    return this.walletsService.requestWithdrawal(userId, dto, idempotencyKey);
  }

  @Get('withdrawals')
  @ApiOperation({ summary: "Get the current user's withdrawal history" })
  async getMyWithdrawals(
    @CurrentUser('id') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.walletsService.getMyWithdrawals(userId, {
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
    });
  }
}
