import { Controller, Get, Post, Body, Param, Query, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PaymentRequestsService } from './payment-requests.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { IsNumber, IsString, IsOptional, IsObject, IsIn, Min, Max, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class CreatePaymentRequestDto {
  @ApiProperty({ example: 50000, description: 'Amount in cents (e.g., 50000 = 500.00 CDF)' })
  @IsNumber()
  @Min(100)
  @Max(99999999999)
  amount_cents!: number;

  @ApiPropertyOptional({ default: 'CDF', enum: ['CDF', 'USD'] })
  @IsOptional()
  @IsIn(['CDF', 'USD'])
  currency?: string;

  @ApiPropertyOptional({ example: 'Achat produits divers' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Customer info: {name, phone}' })
  @IsOptional()
  @IsObject()
  customer_info?: { name?: string; phone?: string };

  @ApiPropertyOptional({ enum: ['MERCHANT_PAID', 'CUSTOMER_PAID', 'SHARED'], default: 'MERCHANT_PAID' })
  @IsOptional()
  @IsString()
  commission_model?: string;

  @ApiPropertyOptional({ default: 30, description: 'Expiration in minutes' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1440)
  expires_in_minutes?: number;
}

@ApiTags('Payment Requests')
@ApiBearerAuth()
@Controller('payment-requests')
export class PaymentRequestsController {
  constructor(private paymentRequestsService: PaymentRequestsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a payment request with QR code' })
  async create(
    @CurrentUser('id') userId: string,
    @CurrentUser('merchant_id') merchantId: string,
    @Body() dto: CreatePaymentRequestDto,
  ) {
    if (!merchantId) {
      throw new BadRequestException('No merchant account associated');
    }
    return this.paymentRequestsService.createPaymentRequest(merchantId, userId, dto);
  }

  @Public()
  @Get('link/:token')
  @ApiOperation({ summary: 'Get payment request by link token (public)' })
  async getByLink(@Param('token') token: string) {
    return this.paymentRequestsService.getByLinkToken(token);
  }

  @Get('reference/:reference')
  @ApiOperation({ summary: 'Get payment request by reference' })
  async getByReference(@Param('reference') reference: string) {
    return this.paymentRequestsService.getByReference(reference);
  }

  @Get()
  @ApiOperation({ summary: 'List merchant payment requests' })
  async listRequests(
    @CurrentUser('merchant_id') merchantId: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.paymentRequestsService.getMerchantRequests(merchantId, {
      status,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
    });
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a payment request' })
  async cancelRequest(
    @Param('id') id: string,
    @CurrentUser('merchant_id') merchantId: string,
  ) {
    return this.paymentRequestsService.cancelRequest(id, merchantId);
  }
}
