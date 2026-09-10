import { Controller, Post, Get, Body, Headers, Param, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class CreatePaymentDto {
  @ApiProperty({ description: 'Payment request link token' })
  @IsString()
  link_token!: string;

  @ApiPropertyOptional({ description: 'Customer email' })
  @IsOptional()
  @IsString()
  customer_email?: string;

  @ApiPropertyOptional({ description: 'Customer phone' })
  @IsOptional()
  @IsString()
  customer_phone?: string;

  @ApiPropertyOptional({ description: 'Customer name' })
  @IsOptional()
  @IsString()
  customer_name?: string;

  @ApiPropertyOptional({ enum: ['mobile_money', 'card'], description: 'Chosen payment method' })
  @IsOptional()
  @IsString()
  payment_method?: string;

  @ApiPropertyOptional({ example: 'airtel', description: 'Mobile money operator, when payment_method is mobile_money' })
  @IsOptional()
  @IsString()
  mobile_money_operator?: string;
}

class PayWithWalletDto {
  @ApiProperty({ description: 'Payment request link token' })
  @IsString()
  link_token!: string;

  @ApiProperty({ description: 'Transaction PIN' })
  @IsString()
  pin!: string;
}

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  @Public()
  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a payment intent (idempotent). Public: the payer may be an anonymous client.' })
  async createPayment(
    @CurrentUser('id') clientId: string | undefined,
    @Body() dto: CreatePaymentDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    return this.paymentsService.createPayment({
      link_token: dto.link_token,
      client_id: clientId,
      idempotency_key: idempotencyKey,
      payment_method: dto.payment_method,
      mobile_money_operator: dto.mobile_money_operator,
      customer: {
        email: dto.customer_email,
        phone: dto.customer_phone,
        name: dto.customer_name,
      },
    });
  }

  @Post('wallet')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Pay an existing payment request (invoice) from the LinkPay wallet — authenticated users only' })
  async payWithWallet(
    @CurrentUser('id') userId: string,
    @Body() dto: PayWithWalletDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    return this.paymentsService.payWithWallet(userId, dto.link_token, dto.pin, idempotencyKey);
  }

  @Public()
  @Get('status/:reference')
  @ApiOperation({ summary: 'Check a payment status by reference (public — the payer may be anonymous). Re-verifies with the PSP if still pending.' })
  async getStatus(@Param('reference') reference: string) {
    return this.paymentsService.getPaymentStatus(reference);
  }
}
