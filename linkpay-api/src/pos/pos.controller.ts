import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsIn, IsNumber, Min, Max, MaxLength, IsBoolean } from 'class-validator';
import { PosService } from './pos.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { RequireLicense } from '../licenses/license.guard';

class CreateTicketDto {
  @ApiProperty({ enum: ['CDF', 'USD'] })
  @IsIn(['CDF', 'USD'])
  currency!: string;

  @ApiPropertyOptional({ description: 'Premier produit à ajouter — crée le ticket et sa première ligne en un seul appel' })
  @IsOptional()
  @IsString()
  first_stock_item_id?: string;
}

class AddTicketItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  stock_item_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  barcode?: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @Min(1)
  quantity!: number;
}

class UpdateItemQuantityDto {
  @ApiProperty({ example: 3, description: 'Nouvelle quantité de la ligne (min 1 — zéro passe par le void autorisé)' })
  @IsNumber()
  @Min(1)
  quantity!: number;
}

class VoidItemDto {
  @ApiPropertyOptional({ example: 'Erreur de scan' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({ description: "Code PIN d'un autre employé — requis pour les comptes staff (caissier)" })
  @IsOptional()
  @IsString()
  supervisor_pin?: string;
}

class HoldTicketDto {
  @ApiPropertyOptional({ example: 'Client parti chercher son portefeuille' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  note?: string;
}

class PayCashDto {
  @ApiPropertyOptional({ description: 'Part du ticket réglée en espèces (défaut : le reste à payer), en centimes' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  amount_cents?: number;

  @ApiPropertyOptional({ description: 'Montant remis par le client (pour la monnaie), en centimes' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  received_cents?: number;
}

class PayScanlinkpayDto {
  @ApiPropertyOptional({ description: 'Part du ticket réglée via ScanLinkPay (défaut : le reste à payer), en centimes' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  amount_cents?: number;
}

class PrintReceiptDto {
  @ApiProperty({ description: 'Texte du ticket pré-formaté (ASCII, largeur fixe)' })
  @IsString()
  @MaxLength(8000)
  text!: string;

  @ApiPropertyOptional({ description: "Imprimante choisie par le caissier (défaut : POS_PRINTER_NAME)" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  printer?: string;
}

class CancelTicketDto {
  @ApiPropertyOptional({ example: 'Client a changé d\'avis' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

class UpdatePosSettingsDto {
  @ApiProperty({ example: 16, description: 'Taux de TVA en % (les prix affichés sont TTC, la taxe est extraite)' })
  @IsNumber()
  @Min(0)
  @Max(100)
  tva_rate_pct!: number;
}

// Supermarket stores belong to organizations — the owner's global role is
// 'enterprise' (merchants.owner_id is always the enterprise owner, see
// merchants.service.ts createMerchant()), and org staff sell via 'caissier'
// or 'magasinier' (POS_SALE_ROLES in stock.service.ts). Fine-grained,
// per-store authorization still happens inside PosService via
// StockService.resolveMerchantAccess() — this is just the coarse gate.
@ApiTags('POS')
@ApiBearerAuth()
@Controller('merchants/:id/pos')
@RequireLicense('pos', 'merchant')
@Roles('enterprise', 'caissier', 'magasinier', 'admin', 'super_admin')
@UseGuards(RolesGuard)
export class PosController {
  constructor(private posService: PosService) {}

  @Get('settings')
  @ApiOperation({ summary: 'POS settings of the store (TVA rate)' })
  async getSettings(
    @Param('id') merchantId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.posService.getSettings(merchantId, callerId, callerRole, callerOrgId);
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update POS settings — owner/admin only' })
  async updateSettings(
    @Param('id') merchantId: string,
    @Body() dto: UpdatePosSettingsDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.posService.updateSettings(merchantId, callerId, callerRole, callerOrgId, dto);
  }

  @Post('tickets')
  @ApiOperation({ summary: 'Start a new sale (requires an open cash-register session in the chosen currency)' })
  async createTicket(
    @Param('id') merchantId: string,
    @Body() dto: CreateTicketDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.posService.createTicket(merchantId, callerId, callerRole, callerOrgId, dto.currency, dto.first_stock_item_id);
  }

  @Get('tickets')
  @ApiOperation({ summary: 'List tickets — held tickets to resume, or paid ones for sales history' })
  async listTickets(
    @Param('id') merchantId: string,
    @Query('status') status: string | undefined,
    @Query('session_id') sessionId: string | undefined,
    @Query('held') held: string | undefined,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.posService.listTickets(merchantId, callerId, callerRole, callerOrgId, {
      status,
      session_id: sessionId,
      held: held === 'true' ? true : undefined,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('tickets/:ticketId')
  @ApiOperation({ summary: 'Ticket detail (items incl. voided, payments, store) — also settles pending ScanLinkPay parts that just got paid' })
  async getTicket(
    @Param('id') merchantId: string,
    @Param('ticketId') ticketId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.posService.getTicket(merchantId, ticketId, callerId, callerRole, callerOrgId);
  }

  @Post('tickets/:ticketId/items')
  @ApiOperation({ summary: 'Add a product to the open ticket, by stock_item_id or barcode (same product merges into its line)' })
  async addItem(
    @Param('id') merchantId: string,
    @Param('ticketId') ticketId: string,
    @Body() dto: AddTicketItemDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.posService.addItem(merchantId, ticketId, callerId, callerRole, callerOrgId, dto);
  }

  @Patch('tickets/:ticketId/items/:itemRowId')
  @ApiOperation({ summary: 'Update a line quantity in place (till steppers) — increases still validate stock; use void to reach zero' })
  async updateItemQuantity(
    @Param('id') merchantId: string,
    @Param('ticketId') ticketId: string,
    @Param('itemRowId') itemRowId: string,
    @Body() dto: UpdateItemQuantityDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.posService.updateItemQuantity(merchantId, ticketId, itemRowId, callerId, callerRole, callerOrgId, dto.quantity);
  }

  @Post('tickets/:ticketId/items/:itemRowId/void')
  @ApiOperation({ summary: 'Void a line with authorization — staff callers need a second employee\'s till PIN' })
  async voidItem(
    @Param('id') merchantId: string,
    @Param('ticketId') ticketId: string,
    @Param('itemRowId') itemRowId: string,
    @Body() dto: VoidItemDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.posService.voidItem(merchantId, ticketId, itemRowId, callerId, callerRole, callerOrgId, dto);
  }

  @Post('tickets/:ticketId/hold')
  @ApiOperation({ summary: 'Put the open ticket on hold (park the sale, resume it later)' })
  async holdTicket(
    @Param('id') merchantId: string,
    @Param('ticketId') ticketId: string,
    @Body() dto: HoldTicketDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.posService.setHeld(merchantId, ticketId, true, callerId, callerRole, callerOrgId, dto.note);
  }

  @Post('tickets/:ticketId/resume')
  @ApiOperation({ summary: 'Resume a held ticket' })
  async resumeTicket(
    @Param('id') merchantId: string,
    @Param('ticketId') ticketId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.posService.setHeld(merchantId, ticketId, false, callerId, callerRole, callerOrgId);
  }

  @Post('tickets/:ticketId/pay/cash')
  @ApiOperation({ summary: 'Record a cash payment — full or partial (rest can go ScanLinkPay)' })
  async payCash(
    @Param('id') merchantId: string,
    @Param('ticketId') ticketId: string,
    @Body() dto: PayCashDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.posService.payCash(merchantId, ticketId, callerId, callerRole, callerOrgId, dto);
  }

  @Post('tickets/:ticketId/pay/scanlinkpay')
  @ApiOperation({ summary: 'Mint a ScanLinkPay QR for the remaining amount (or a given part) — stock deducted once actually paid' })
  async payScanlinkpay(
    @Param('id') merchantId: string,
    @Param('ticketId') ticketId: string,
    @Body() dto: PayScanlinkpayDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.posService.payScanlinkpay(merchantId, ticketId, callerId, callerRole, callerOrgId, dto);
  }

  @Get('printers')
  @ApiOperation({ summary: 'Liste les imprimantes installées sur la machine caisse — le choix est fait une fois puis mémorisé côté navigateur' })
  async listPrinters(
    @Param('id') merchantId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.posService.listPrinters(merchantId, callerId, callerRole, callerOrgId);
  }

  @Post('print-receipt')
  @ApiOperation({ summary: 'Imprime un ticket directement sur l\'imprimante thermique locale — aucun dialogue navigateur' })
  async printReceipt(
    @Param('id') merchantId: string,
    @Body() dto: PrintReceiptDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.posService.printReceipt(merchantId, callerId, callerRole, callerOrgId, dto.text, dto.printer);
  }

  @Post('tickets/:ticketId/payments/:paymentId/void')
  @ApiOperation({ summary: 'Drop a pending ScanLinkPay payment part (customer pays another way instead)' })
  async voidPayment(
    @Param('id') merchantId: string,
    @Param('ticketId') ticketId: string,
    @Param('paymentId') paymentId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.posService.voidPayment(merchantId, ticketId, paymentId, callerId, callerRole, callerOrgId);
  }

  @Post('tickets/:ticketId/cancel')
  @ApiOperation({ summary: 'Cancel an unpaid ticket (refused once a payment row exists)' })
  async cancelTicket(
    @Param('id') merchantId: string,
    @Param('ticketId') ticketId: string,
    @Body() dto: CancelTicketDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.posService.cancelTicket(merchantId, ticketId, callerId, callerRole, callerOrgId, dto.reason);
  }
}
