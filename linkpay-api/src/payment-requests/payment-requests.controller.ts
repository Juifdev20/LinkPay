import { Controller, Get, Post, Body, Param, Query, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PaymentRequestsService } from './payment-requests.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { IsNumber, IsString, IsOptional, IsObject, IsIn, Min, Max, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { toPage, toLimit } from '../common/utils/pagination';

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

class QuickPayDto {
  @ApiProperty({ example: 'SLP-000123', description: "The business's ScanLinkPay number (scanned QR or typed manually)" })
  @IsString()
  scanlinkpay_number!: string;

  @ApiPropertyOptional({ description: 'Which store receives the payment — required if the business has more than one' })
  @IsOptional()
  @IsString()
  merchant_id?: string;

  @ApiProperty({ example: 50000, description: 'Amount the payer chose, in cents' })
  @IsNumber()
  @Min(100)
  @Max(99999999999)
  amount_cents!: number;

  @ApiPropertyOptional({ default: 'CDF', enum: ['CDF', 'USD'] })
  @IsOptional()
  @IsIn(['CDF', 'USD'])
  currency?: string;

  @ApiPropertyOptional({
    enum: ['MERCHANT_PAID', 'CUSTOMER_PAID', 'SHARED'],
    default: 'MERCHANT_PAID',
    description: "Who bears the ScanLinkPay commission: the business (default), the payer (the payer pays amount + commission) or both halves.",
  })
  @IsOptional()
  @IsIn(['MERCHANT_PAID', 'CUSTOMER_PAID', 'SHARED'])
  commission_model?: string;

  @ApiPropertyOptional({ description: "What the payment is for, shown to the business in its transactions (e.g. « Abonnement HotelSaver — Hôtel X »)." })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiPropertyOptional({ default: 30, description: 'Minutes before the payment request expires (1–1440).' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1440)
  expires_in_minutes?: number;
}

class FeesPreviewQuery {
  @ApiProperty({ example: 'SLP-000123' })
  @IsString()
  scanlinkpay_number!: string;

  @ApiPropertyOptional({ description: 'Required when the business has several stores' })
  @IsOptional()
  @IsString()
  merchant_id?: string;

  @ApiProperty({ example: 50000, description: 'Amount in cents' })
  @IsString()
  amount_cents!: string;

  @ApiPropertyOptional({ default: 'CDF', enum: ['CDF', 'USD'] })
  @IsOptional()
  @IsIn(['CDF', 'USD'])
  currency?: string;

  @ApiPropertyOptional({ enum: ['MERCHANT_PAID', 'CUSTOMER_PAID', 'SHARED'], default: 'MERCHANT_PAID' })
  @IsOptional()
  @IsIn(['MERCHANT_PAID', 'CUSTOMER_PAID', 'SHARED'])
  commission_model?: string;
}

/** Control characters out of a free-text label (it ends up in lists and exports). */
const cleanLabel = (value?: string) => (value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

@ApiTags('Payment Requests')
@ApiBearerAuth()
@Controller('payment-requests')
export class PaymentRequestsController {
  constructor(
    private paymentRequestsService: PaymentRequestsService,
    private organizationsService: OrganizationsService,
  ) {}

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

  // Public and unauthenticated: a tighter per-IP limit than the global one,
  // so nobody can flood a business with junk payment requests.
  /** The store that receives a payment made with a ScanLinkPay number: the one named, or the only one. */
  private async resolveQuickPayMerchant(scanlinkpayNumber: string, merchantIdWanted?: string) {
    const org = await this.organizationsService.getOrganizationByScanLinkPayNumber(scanlinkpayNumber);

    let merchantId = merchantIdWanted;
    if (merchantId) {
      if (!org.merchants.some((m: any) => m.id === merchantId)) {
        throw new BadRequestException("Cette boutique n'appartient pas à cette entreprise");
      }
    } else if (org.merchants.length === 1) {
      merchantId = org.merchants[0].id;
    } else if (org.merchants.length === 0) {
      throw new BadRequestException("Cette entreprise n'a pas encore de boutique pouvant recevoir un paiement");
    } else {
      throw new BadRequestException('merchant_id requis — cette entreprise a plusieurs boutiques');
    }
    return { org, merchantId: merchantId! };
  }

  // Public and unauthenticated: a tighter per-IP limit than the global one,
  // so nobody can flood a business with junk payment requests.
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('quick-pay')
  @ApiOperation({ summary: "Create a payment request by ScanLinkPay number (public — payer chooses the amount, no merchant-side invoice needed). The answer carries the fees (`fees`) for the chosen commission model." })
  async quickPay(@Body() dto: QuickPayDto) {
    const { merchantId } = await this.resolveQuickPayMerchant(dto.scanlinkpay_number, dto.merchant_id);
    const label = cleanLabel(dto.description);

    return this.paymentRequestsService.createPaymentRequest(merchantId, undefined, {
      amount_cents: dto.amount_cents,
      currency: dto.currency,
      description: label || `Paiement via numéro ScanLinkPay ${dto.scanlinkpay_number}`,
      commission_model: dto.commission_model,
      expires_in_minutes: dto.expires_in_minutes,
    }, { withQrCode: false });
  }

  // Public: lets an integrator (a hotel booking site, a subscription page) show the payer what will be charged BEFORE anything is created.
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get('fees-preview')
  @ApiOperation({ summary: 'Preview the ScanLinkPay fees of a payment to a business (public) — nothing is created' })
  async feesPreview(@Query() query: FeesPreviewQuery) {
    const amount = Number(query.amount_cents);
    if (!Number.isInteger(amount) || amount < 100 || amount > 99999999999) {
      throw new BadRequestException('amount_cents doit être un entier entre 100 et 99999999999');
    }
    const { org, merchantId } = await this.resolveQuickPayMerchant(query.scanlinkpay_number, query.merchant_id);
    return this.paymentRequestsService.previewFees(merchantId, amount, query.currency ?? 'CDF', query.commission_model ?? 'MERCHANT_PAID', {
      business: org.legal_name || org.name,
    });
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
      page: toPage(page),
      limit: toLimit(limit),
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
