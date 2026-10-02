import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { StockService, POS_SALE_ROLES } from '../stock/stock.service';
import { PaymentRequestsService } from '../payment-requests/payment-requests.service';
import { AuditService } from '../audit/audit.service';

/**
 * Point of sale — a ticket is always a single currency, chosen when the
 * sale starts (never mixed CDF/USD on one ticket, matching how a physical
 * till actually works). Stock is deducted by inserting a 'sale'-type row
 * into the EXISTING stock_movements ledger (see StockService.createMovement)
 * — this reuses the already-working quantity trigger and low-stock
 * notification, nothing duplicated here.
 *
 * ScanLinkPay payment reuses PaymentRequestsService.createPaymentRequest()
 * as-is — a POS ticket just mints a normal payment request for its total
 * and links back to it; settlement (stock deduction + marking the ticket
 * paid) happens once the linked payment_request is actually confirmed PAID,
 * not at QR-creation time — see trySettleScanlinkpayTicket().
 */
@Injectable()
export class PosService {
  private readonly logger = new Logger(PosService.name);

  constructor(
    private supabaseService: SupabaseService,
    private stockService: StockService,
    private paymentRequestsService: PaymentRequestsService,
    private auditService: AuditService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  private async assertAccess(merchantId: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    return this.stockService.resolveMerchantAccess(merchantId, callerId, callerRole, callerOrgId, POS_SALE_ROLES);
  }

  private async getOwnTicket(merchantId: string, ticketId: string) {
    const { data: ticket, error } = await this.db
      .from('pos_tickets')
      .select('*')
      .eq('id', ticketId)
      .eq('merchant_id', merchantId)
      .single();

    if (error || !ticket) throw new NotFoundException('Ticket introuvable');
    return ticket;
  }

  private async getTicketItems(ticketId: string) {
    const { data } = await this.db
      .from('pos_ticket_items')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });
    return data || [];
  }

  private async recomputeTotals(ticketId: string) {
    const items = await this.getTicketItems(ticketId);
    const total = items.reduce((sum, i) => sum + i.line_total_cents, 0);
    await this.db.from('pos_tickets').update({ subtotal_cents: total, total_cents: total, updated_at: new Date().toISOString() }).eq('id', ticketId);
    return total;
  }

  private async findOpenSession(merchantId: string, currency: string) {
    const { data } = await this.db
      .from('cash_register_sessions')
      .select('*')
      .eq('merchant_id', merchantId)
      .eq('currency', currency)
      .eq('status', 'open')
      .maybeSingle();
    return data;
  }

  async createTicket(merchantId: string, callerId: string, callerRole: string, callerOrgId: string | undefined, currency: string) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);

    const session = await this.findOpenSession(merchantId, currency);
    if (!session) {
      throw new BadRequestException(`Aucune session de caisse ouverte en ${currency} pour cette boutique — ouvrez la caisse avant de vendre.`);
    }

    const { data: ticket, error } = await this.db
      .from('pos_tickets')
      .insert({
        merchant_id: merchantId,
        cashier_user_id: callerId,
        cash_register_session_id: session.id,
        currency,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create ticket: ${error.message}`);
    return { ...ticket, items: [] };
  }

  async getTicket(merchantId: string, ticketId: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    let ticket = await this.getOwnTicket(merchantId, ticketId);

    if (ticket.status === 'open' && ticket.payment_method === 'scanlinkpay' && ticket.payment_request_id) {
      ticket = await this.trySettleScanlinkpayTicket(ticket, callerId, callerRole, callerOrgId);
    }

    const items = await this.getTicketItems(ticketId);
    return { ...ticket, items };
  }

  /** Looks up the linked payment_request; if it's confirmed PAID, atomically
   * claims and settles the ticket (deducts stock, marks paid) exactly once —
   * same compare-and-swap guard as WalletsService.completeTopup(), since a
   * webhook and this poll-driven check can both race to settle the same
   * ticket. */
  private async trySettleScanlinkpayTicket(ticket: any, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    const { data: request } = await this.db
      .from('payment_requests')
      .select('status')
      .eq('id', ticket.payment_request_id)
      .single();

    if (!request || request.status !== 'PAID') return ticket;

    const { data: claimed } = await this.db
      .from('pos_tickets')
      .update({ status: 'paid', paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', ticket.id)
      .eq('status', 'open')
      .select()
      .maybeSingle();

    if (!claimed) return ticket; // someone else already settled it

    await this.deductStockForTicket(ticket, callerId, callerRole, callerOrgId);
    return claimed;
  }

  private async deductStockForTicket(ticket: any, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    const items = await this.getTicketItems(ticket.id);
    for (const item of items) {
      try {
        await this.stockService.createMovement(ticket.merchant_id, item.stock_item_id, callerId, callerRole, callerOrgId, {
          type: 'sale',
          quantity_delta: -item.quantity,
          reason: `Vente ticket ${ticket.id}`,
        });
      } catch (err: any) {
        // Never block a confirmed sale on a stock hiccup (e.g. the item was
        // deleted after the ticket was built) — log and move on, same
        // "best-effort side effect" philosophy as the low-stock notification
        // inside createMovement() itself.
        this.logger.error(`Stock deduction failed for ticket ${ticket.id}, item ${item.stock_item_id}: ${err.message}`);
      }
    }
  }

  async addItem(
    merchantId: string,
    ticketId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    data: { stock_item_id?: string; barcode?: string; quantity: number },
  ) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    const ticket = await this.getOwnTicket(merchantId, ticketId);
    if (ticket.status !== 'open') {
      throw new BadRequestException('Ce ticket est déjà clôturé.');
    }

    let stockItem: any;
    if (data.barcode) {
      stockItem = await this.stockService.getItemByBarcode(merchantId, data.barcode, callerId, callerRole, callerOrgId);
    } else if (data.stock_item_id) {
      const { data: item } = await this.db
        .from('stock_items')
        .select('id, name, unit_price_cents, currency, quantity')
        .eq('id', data.stock_item_id)
        .eq('merchant_id', merchantId)
        .single();
      stockItem = item;
    }

    if (!stockItem) throw new NotFoundException('Produit introuvable dans cette boutique');
    if (stockItem.currency !== ticket.currency) {
      throw new BadRequestException(`Cet article est en ${stockItem.currency}, le ticket est en ${ticket.currency}.`);
    }
    if (stockItem.quantity < data.quantity) {
      throw new BadRequestException(`Stock insuffisant : il ne reste que ${stockItem.quantity} unité(s).`);
    }

    const lineTotal = stockItem.unit_price_cents * data.quantity;
    const { error } = await this.db.from('pos_ticket_items').insert({
      ticket_id: ticketId,
      stock_item_id: stockItem.id,
      product_name_snapshot: stockItem.name,
      quantity: data.quantity,
      unit_price_cents_snapshot: stockItem.unit_price_cents,
      line_total_cents: lineTotal,
    });

    if (error) throw new Error(`Failed to add ticket item: ${error.message}`);

    await this.recomputeTotals(ticketId);
    return this.getTicket(merchantId, ticketId, callerId, callerRole, callerOrgId);
  }

  async removeItem(merchantId: string, ticketId: string, itemRowId: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    const ticket = await this.getOwnTicket(merchantId, ticketId);
    if (ticket.status !== 'open') {
      throw new BadRequestException('Ce ticket est déjà clôturé.');
    }

    await this.db.from('pos_ticket_items').delete().eq('id', itemRowId).eq('ticket_id', ticketId);
    await this.recomputeTotals(ticketId);
    return this.getTicket(merchantId, ticketId, callerId, callerRole, callerOrgId);
  }

  async payCash(merchantId: string, ticketId: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    const ticket = await this.getOwnTicket(merchantId, ticketId);
    if (ticket.status !== 'open') {
      throw new BadRequestException('Ce ticket est déjà clôturé.');
    }
    const items = await this.getTicketItems(ticketId);
    if (!items.length) {
      throw new BadRequestException('Le ticket est vide.');
    }

    const { data: claimed, error } = await this.db
      .from('pos_tickets')
      .update({ status: 'paid', payment_method: 'cash', paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', ticketId)
      .eq('status', 'open')
      .select()
      .single();

    if (error || !claimed) throw new BadRequestException('Ce ticket est déjà clôturé.');

    await this.deductStockForTicket(claimed, callerId, callerRole, callerOrgId);
    return { ...claimed, items };
  }

  async payScanlinkpay(merchantId: string, ticketId: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    const ticket = await this.getOwnTicket(merchantId, ticketId);
    if (ticket.status !== 'open') {
      throw new BadRequestException('Ce ticket est déjà clôturé.');
    }
    if (ticket.payment_request_id) {
      // Already has one — return the existing QR instead of minting a duplicate.
      const { data: existing } = await this.db.from('payment_requests').select('*').eq('id', ticket.payment_request_id).single();
      return { ticket, payment_request: existing };
    }
    const items = await this.getTicketItems(ticketId);
    if (!items.length) {
      throw new BadRequestException('Le ticket est vide.');
    }

    const request = await this.paymentRequestsService.createPaymentRequest(merchantId, undefined, {
      amount_cents: ticket.total_cents,
      currency: ticket.currency,
      description: `Ticket POS ${ticketId.slice(0, 8)}`,
    });

    const { data: updated, error } = await this.db
      .from('pos_tickets')
      .update({ payment_request_id: request.id, payment_method: 'scanlinkpay', updated_at: new Date().toISOString() })
      .eq('id', ticketId)
      .select()
      .single();

    if (error) throw new Error(`Failed to link payment request: ${error.message}`);
    return { ticket: updated, payment_request: request };
  }

  async cancelTicket(merchantId: string, ticketId: string, callerId: string, callerRole: string, callerOrgId: string | undefined, reason?: string) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    const ticket = await this.getOwnTicket(merchantId, ticketId);
    if (ticket.status === 'paid') {
      throw new BadRequestException('Un ticket déjà payé ne peut pas être annulé.');
    }
    if (ticket.status === 'cancelled') {
      throw new BadRequestException('Ce ticket est déjà annulé.');
    }

    const { data: updated, error } = await this.db
      .from('pos_tickets')
      .update({
        status: 'cancelled',
        cancelled_reason: reason || null,
        cancelled_by: callerId,
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', ticketId)
      .select()
      .single();

    if (error) throw new Error(`Failed to cancel ticket: ${error.message}`);

    await this.auditService.log({
      user_id: callerId,
      action: 'ticket_cancelled',
      entity_type: 'pos_ticket',
      entity_id: ticketId,
      changes: { reason },
    });

    return updated;
  }
}
