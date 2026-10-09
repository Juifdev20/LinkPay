import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { CardsService } from './cards.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { OtpStepUpGuard, RequireOtp } from '../security/otp-step-up.guard';
import { RequireDeviceIntegrity } from '../integrity/device-integrity.guard';
import { toPage, toLimit } from '../common/utils/pagination';

const PIN = /^\d{4,8}$/;

export class PinDto {
  @ApiProperty({ description: 'Transaction PIN of the wallet' })
  @IsString()
  @Matches(PIN, { message: 'PIN invalide' })
  pin!: string;
}

export class ActivateCardDto extends PinDto {
  @ApiProperty({ description: 'The 16 digits printed on the card', example: '9243 0012 3456 7895' })
  @IsString()
  @MaxLength(25)
  card_number!: string;
}

export class CreateChargeDto {
  @ApiPropertyOptional({ description: 'What the QR code of the card contains (link or token)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  qr_token?: string;

  @ApiPropertyOptional({ description: 'The 16 digits of the card, when the QR code cannot be scanned' })
  @IsOptional()
  @IsString()
  @MaxLength(25)
  card_number?: string;

  @ApiProperty({ example: 50000, description: 'Amount in cents' })
  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(100)
  @Max(99999999999)
  amount_cents!: number;

  @ApiProperty({ enum: ['CDF', 'USD'] })
  @IsIn(['CDF', 'USD'])
  currency!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiPropertyOptional({ description: 'Which store is paid, for a business with several (the oldest by default)' })
  @IsOptional()
  @IsUUID()
  merchant_id?: string;
}

export class IssueCardDto {
  @ApiPropertyOptional({ example: 'LP-00001234', description: "The person's ScanLinkPay (wallet) number" })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  wallet_number?: string;

  @ApiPropertyOptional({ description: 'A request made by the person in the app' })
  @IsOptional()
  @IsUUID()
  card_id?: string;

  @ApiPropertyOptional({ description: 'The person already has a card: replace it (the old one stops working)' })
  @IsOptional()
  @IsBoolean()
  replace?: boolean;
}

export class BlockCardDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  reason!: string;
}

/** What every logged-in person does with their own card. */
@ApiTags('Cards')
@ApiBearerAuth()
@Controller('cards')
export class CardsController {
  constructor(private cards: CardsService) {}

  @Get('me')
  @ApiOperation({ summary: 'My card, the balances of my wallet, and what the back of the card shows' })
  me(@CurrentUser('id') userId: string) {
    return this.cards.getMyCard(userId);
  }

  @Post('me/request')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Ask for my card' })
  request(@CurrentUser('id') userId: string) {
    return this.cards.requestCard(userId);
  }

  @Post('me/activate')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Activate the card I was handed: the 16 digits on it and my PIN' })
  activate(@CurrentUser('id') userId: string, @Body() dto: ActivateCardDto) {
    return this.cards.activate(userId, dto.card_number, dto.pin);
  }

  @Post('me/freeze')
  @ApiOperation({ summary: 'Pause my card' })
  freeze(@CurrentUser('id') userId: string) {
    return this.cards.freeze(userId);
  }

  @Post('me/unfreeze')
  @ApiOperation({ summary: 'Resume my card (PIN)' })
  unfreeze(@CurrentUser('id') userId: string, @Body() dto: PinDto) {
    return this.cards.unfreeze(userId, dto.pin);
  }

  @Post('me/report-lost')
  @ApiOperation({ summary: 'My card is lost or stolen: block it for good (PIN)' })
  reportLost(@CurrentUser('id') userId: string, @Body() dto: PinDto) {
    return this.cards.reportLost(userId, dto.pin);
  }

  @Get('resolve/:token')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Who is this card (first name + initial) and where to send money' })
  resolve(@Param('token') token: string) {
    return this.cards.resolveForSend(token);
  }

  // ---- holder: the charges waiting for my approval
  @Get('charges/pending')
  @ApiOperation({ summary: 'Payments waiting for my confirmation' })
  pending(@CurrentUser('id') userId: string) {
    return this.cards.pendingForHolder(userId);
  }

  @Post('charges/:id/approve')
  @RequireDeviceIntegrity()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Approve a card payment with my PIN' })
  approve(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PinDto) {
    return this.cards.approve(userId, id, dto.pin);
  }

  @Post('charges/:id/decline')
  @ApiOperation({ summary: 'Refuse a card payment' })
  decline(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.cards.decline(userId, id);
  }
}

/** The till: scan a customer's card and ask to be paid. */
@ApiTags('Cards')
@ApiBearerAuth()
@Controller('cards/merchant-charges')
@Roles('merchant', 'enterprise', 'cashier', 'caissier', 'vendeur')
@UseGuards(RolesGuard)
export class CardChargesController {
  constructor(private cards: CardsService) {}

  @Post()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Charge a card: the holder confirms with their PIN on their phone' })
  async create(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('merchant_id') merchantId: string | undefined,
    @CurrentUser('organization_id') organizationId: string | undefined,
    @Body() dto: CreateChargeDto,
  ) {
    const store = await this.cards.resolveSellerMerchant({ userId, role, merchantId, organizationId }, dto.merchant_id);
    const { merchant_id: _ignored, ...charge } = dto;
    return this.cards.createCharge({ userId, merchantId: store }, charge);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Has the holder paid yet?' })
  status(@CurrentUser('id') userId: string, @CurrentUser('merchant_id') merchantId: string | undefined, @Param('id', ParseUUIDPipe) id: string) {
    return this.cards.getChargeForMerchant({ userId, merchantId }, id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a charge that was not paid yet' })
  cancel(@CurrentUser('id') userId: string, @CurrentUser('merchant_id') merchantId: string | undefined, @Param('id', ParseUUIDPipe) id: string) {
    return this.cards.cancelCharge({ userId, merchantId }, id);
  }
}

/** The super admin prints the cards. */
@ApiTags('Cards')
@ApiBearerAuth()
@Controller('admin/cards')
@Roles('admin', 'super_admin')
@UseGuards(RolesGuard)
export class CardsAdminController {
  constructor(private cards: CardsService) {}

  @Get()
  @ApiOperation({ summary: 'Cards and requests (filter by status, search by name, e-mail, ScanLinkPay number or card number)' })
  list(@Query('status') status?: string, @Query('q') q?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    const allowed = ['requested', 'issued', 'active', 'frozen', 'blocked', 'replaced'];
    return this.cards.adminList({ status: status && allowed.includes(status) ? status : undefined, q, page: toPage(page), limit: toLimit(limit) });
  }

  // Declared before ':id' so "settings" is never taken for an id.
  @Get('settings')
  @ApiOperation({ summary: 'Contact, domain, validity and partner logos of the card' })
  settings() {
    return this.cards.getSettings();
  }

  @Put('settings')
  @Roles('super_admin')
  @UseGuards(OtpStepUpGuard)
  @RequireOtp()
  @ApiOperation({ summary: 'Change the card settings (super admin)' })
  updateSettings(@CurrentUser('id') adminId: string, @Body() body: unknown) {
    return this.cards.updateSettings(adminId, body);
  }

  @Post('issue')
  @ApiOperation({ summary: "Prepare a card from the person's ScanLinkPay number (or from their request)" })
  issue(@CurrentUser('id') adminId: string, @Body() dto: IssueCardDto) {
    return this.cards.issue(adminId, dto);
  }

  // A POST: opening the print view is counted and audited, a GET must not do that.
  @Post(':id/print')
  @ApiOperation({ summary: 'Everything needed to print a card that is waiting to be handed over' })
  print(@CurrentUser('id') adminId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.cards.printData(adminId, id);
  }

  @Post(':id/block')
  @ApiOperation({ summary: 'Block a card' })
  block(@CurrentUser('id') adminId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BlockCardDto) {
    return this.cards.adminBlock(adminId, id, dto.reason);
  }
}
