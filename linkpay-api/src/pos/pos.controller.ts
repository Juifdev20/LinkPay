import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsIn, IsNumber, Min, MaxLength } from 'class-validator';
import { PosService } from './pos.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

class CreateTicketDto {
  @ApiProperty({ enum: ['CDF', 'USD'] })
  @IsIn(['CDF', 'USD'])
  currency!: string;
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

class CancelTicketDto {
  @ApiPropertyOptional({ example: 'Client a changé d\'avis' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

// Supermarket stores belong to organizations — the owner's global role is
// 'enterprise' (merchants.owner_id is always the enterprise owner, see
// merchants.service.ts createMerchant()), and an org-scoped cashier's role
// is 'caissier' (seeded in 029_staff_roles_seed.sql). Fine-grained,
// per-store authorization still happens inside PosService via
// StockService.resolveMerchantAccess() — this is just the coarse gate.
@ApiTags('POS')
@ApiBearerAuth()
@Controller('merchants/:id/pos')
@Roles('enterprise', 'caissier', 'admin', 'super_admin')
@UseGuards(RolesGuard)
export class PosController {
  constructor(private posService: PosService) {}

  @Post('tickets')
  @ApiOperation({ summary: 'Start a new sale (requires an open cash-register session in the chosen currency)' })
  async createTicket(
    @Param('id') merchantId: string,
    @Body() dto: CreateTicketDto,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.posService.createTicket(merchantId, callerId, callerRole, callerOrgId, dto.currency);
  }

  @Get('tickets/:ticketId')
  @ApiOperation({ summary: 'Ticket status — also settles it (deducts stock) if its linked ScanLinkPay payment just got confirmed' })
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
  @ApiOperation({ summary: 'Add a product to the open ticket, by stock_item_id or barcode' })
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

  @Delete('tickets/:ticketId/items/:itemRowId')
  @ApiOperation({ summary: 'Remove a line from the open ticket' })
  async removeItem(
    @Param('id') merchantId: string,
    @Param('ticketId') ticketId: string,
    @Param('itemRowId') itemRowId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.posService.removeItem(merchantId, ticketId, itemRowId, callerId, callerRole, callerOrgId);
  }

  @Post('tickets/:ticketId/pay/cash')
  @ApiOperation({ summary: 'Settle the ticket in cash — deducts stock immediately' })
  async payCash(
    @Param('id') merchantId: string,
    @Param('ticketId') ticketId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.posService.payCash(merchantId, ticketId, callerId, callerRole, callerOrgId);
  }

  @Post('tickets/:ticketId/pay/scanlinkpay')
  @ApiOperation({ summary: 'Create a ScanLinkPay QR for the ticket total — stock is deducted once the customer actually pays, not here' })
  async payScanlinkpay(
    @Param('id') merchantId: string,
    @Param('ticketId') ticketId: string,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    return this.posService.payScanlinkpay(merchantId, ticketId, callerId, callerRole, callerOrgId);
  }

  @Post('tickets/:ticketId/cancel')
  @ApiOperation({ summary: 'Cancel an unpaid ticket' })
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
