import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { SupabaseService } from '../supabase/supabase.service';
import { StockService, POS_SALE_ROLES } from '../stock/stock.service';
import { PaymentRequestsService } from '../payment-requests/payment-requests.service';
import { AuditService } from '../audit/audit.service';
import { CashierPinService } from '../organization-staff/cashier-pin.service';

// Job roles of organization-internal staff (seeded in 029) — used to decide
// whether voiding a ticket line requires a second employee's PIN.
const STAFF_JOB_ROLES = ['magasinier', 'vendeur', 'caissier', 'comptable'];

/**
 * Point of sale — a ticket is always a single currency, chosen when the
 * sale starts (never mixed CDF/USD on one ticket, matching how a physical
 * till actually works). Stock is deducted by inserting a 'sale'-type row
 * into the EXISTING stock_movements ledger (see StockService.createMovement)
 * — this reuses the already-working quantity trigger and low-stock
 * notification, nothing duplicated here.
 *
 * Phase 2 (see 034_pos_phase2.sql):
 * - Displayed prices are TTC (tax-inclusive); TVA is extracted from the
 *   total at the store's own rate (merchants.pos_tva_rate_pct, 16% default).
 *   subtotal_cents = HT, tva_cents = TVA, total_cents = TTC (amount due).
 * - Lines are never deleted — voiding marks them 'voided' with who/why and,
 *   for staff callers, the PIN of a second employee who authorized it.
 * - A ticket can combine several payment methods (pos_ticket_payments);
 *   it's only settled when CONFIRMED payments cover the total. ScanLinkPay
 *   parts stay 'pending' until their payment_request is actually PAID.
 */
@Injectable()
export class PosService {
  private readonly logger = new Logger(PosService.name);
  private readonly execFileAsync = promisify(execFile);

  constructor(
    private supabaseService: SupabaseService,
    private stockService: StockService,
    private paymentRequestsService: PaymentRequestsService,
    private auditService: AuditService,
    private cashierPinService: CashierPinService,
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

  private async getTicketPayments(ticketId: string) {
    const { data } = await this.db
      .from('pos_ticket_payments')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });
    return data || [];
  }

  /** HT / TVA / TTC — prices on the shelf are TTC, so the tax is extracted:
   * tva = total × rate / (100 + rate). Only 'active' lines count (voided
   * lines stay on the ticket for traceability but don't add to the bill). */
  private async recomputeTotals(ticket: any) {
    const items = await this.getTicketItems(ticket.id);
    const total = items.filter((i) => i.status === 'active').reduce((sum, i) => sum + i.line_total_cents, 0);

    const { data: merchant } = await this.db
      .from('merchants')
      .select('pos_tva_rate_pct')
      .eq('id', ticket.merchant_id)
      .single();
    const rate = Number(merchant?.pos_tva_rate_pct ?? 0);
    const tva = rate > 0 ? Math.round((total * rate) / (100 + rate)) : 0;

    await this.db
      .from('pos_tickets')
      .update({
        subtotal_cents: total - tva,
        tva_cents: tva,
        total_cents: total,
        updated_at: new Date().toISOString(),
      })
      .eq('id', ticket.id);
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

  private async nextTicketNumber(merchantId: string): Promise<number> {
    const { data, error } = await this.db.rpc('next_pos_ticket_number', { p_merchant_id: merchantId });
    if (error) throw new Error(`Failed to assign ticket number: ${error.message}`);
    return data as number;
  }

  /** Lists the printers installed on the machine running this API — the
   *  till machine is also where the thermal printer is plugged in. Used by
   *  the UI so the cashier picks the printer ONCE; the choice is then kept
   *  in the browser and sent back on each print. */
  async listPrinters(
    merchantId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
  ) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    const { stdout } = await this.execFileAsync('powershell', [
      '-NoProfile', '-Command',
      "Get-Printer | Select-Object -ExpandProperty Name",
    ]);
    return {
      printers: stdout.split(/\r?\n/).map((n) => n.trim()).filter(Boolean),
    };
  }

  /** Sends pre-formatted receipt text straight to the local thermal printer —
   *  the cashier clicks "Imprimer" and the ticket comes out, no print dialog.
   *  Uses Windows' raw `print /D:` spooler call, which passes the text through
   *  to "Generic / Text Only" drivers byte-for-byte. The printer name comes
   *  from POS_PRINTER_NAME (env) — the UI falls back to window.print() when
   *  this throws (no printer configured on this machine). */
  async printReceipt(
    merchantId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    text: string,
    printerName?: string,
  ) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    const printer = printerName || process.env.POS_PRINTER_NAME || 'POS-Thermique';
    const file = join(tmpdir(), `linkpay-receipt-${Date.now()}.txt`);
    await writeFile(file, text, 'ascii');
    try {
      await this.execFileAsync('print', [`/D:${printer}`, file]);
    } catch (err: any) {
      throw new BadRequestException(`Imprimante "${printer}" indisponible : ${err.message}`);
    } finally {
      unlink(file).catch(() => {});
    }
    return { printed: true };
  }

  private async withDetails(ticket: any) {
    const [items, payments, merchantRes] = await Promise.all([
      this.getTicketItems(ticket.id),
      this.getTicketPayments(ticket.id),
      this.db
        .from('merchants')
        .select('name, phone, address, logo_url, pos_tva_rate_pct, organizations(name)')
        .eq('id', ticket.merchant_id)
        .single(),
    ]);
    const merchant: any = merchantRes.data || null;
    // Flatten the org join — the receipt header shows the organization name
    // (multi-tenant: many stores can share one org identity).
    if (merchant) {
      const org = merchant.organizations;
      merchant.organization_name = (Array.isArray(org) ? org[0]?.name : org?.name) ?? null;
      delete merchant.organizations;
    }
    return { ...ticket, items, payments, merchant };
  }

  async createTicket(merchantId: string, callerId: string, callerRole: string, callerOrgId: string | undefined, currency: string) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);

    const session = await this.findOpenSession(merchantId, currency);
    if (!session) {
      throw new BadRequestException(`Aucune session de caisse ouverte en ${currency} pour cette boutique — ouvrez la caisse avant de vendre.`);
    }

    const ticketNumber = await this.nextTicketNumber(merchantId);
    const { data: ticket, error } = await this.db
      .from('pos_tickets')
      .insert({
        merchant_id: merchantId,
        cashier_user_id: callerId,
        cash_register_session_id: session.id,
        currency,
        ticket_number: ticketNumber,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create ticket: ${error.message}`);
    return { ...ticket, items: [], payments: [] };
  }

  /** List tickets — held tickets for the till resume UI, paid tickets for
   * the sales history, optionally scoped to one cash-register session. */
  async listTickets(
    merchantId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    filters: { status?: string; session_id?: string; held?: boolean; page?: number; limit?: number },
  ) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);

    let query = this.db
      .from('pos_tickets')
      .select('*, payments:pos_ticket_payments(*)', { count: 'exact' })
      .eq('merchant_id', merchantId)
      .order('created_at', { ascending: false });

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.session_id) query = query.eq('cash_register_session_id', filters.session_id);
    if (filters.held) query = query.eq('is_held', true);

    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 30, 100);
    query = query.range((page - 1) * limit, page * limit - 1);

    const { data, error, count } = await query;
    if (error) throw new Error(`Failed to list tickets: ${error.message}`);
    return { data: data || [], total: count || 0, page, limit };
  }

  async getTicket(merchantId: string, ticketId: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    let ticket = await this.getOwnTicket(merchantId, ticketId);

    if (ticket.status === 'open') {
      ticket = await this.trySettleScanlinkpayTicket(ticket, callerId, callerRole, callerOrgId);
    }

    return this.withDetails(ticket);
  }

  /** Confirms pending ScanLinkPay payment rows whose payment_request is now
   * PAID, then settles the ticket if confirmed payments cover the total. */
  private async trySettleScanlinkpayTicket(ticket: any, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    const { data: pending } = await this.db
      .from('pos_ticket_payments')
      .select('id, payment_request_id')
      .eq('ticket_id', ticket.id)
      .eq('method', 'scanlinkpay')
      .eq('status', 'pending');

    if (pending?.length) {
      for (const payment of pending) {
        const { data: request } = await this.db
          .from('payment_requests')
          .select('status')
          .eq('id', payment.payment_request_id)
          .single();

        if (request?.status === 'PAID') {
          await this.db
            .from('pos_ticket_payments')
            .update({ status: 'confirmed' })
            .eq('id', payment.id)
            .eq('status', 'pending');
        }
      }
      return this.settleIfFullyPaid(ticket, callerId, callerRole, callerOrgId);
    }

    // Legacy path — a pre-034 ticket has payment_request_id directly on the
    // ticket and no pos_ticket_payments row. Same compare-and-swap guard as
    // before: settle it (deduct stock, mark paid) exactly once.
    if (ticket.payment_request_id) {
      const { data: request } = await this.db
        .from('payment_requests')
        .select('status')
        .eq('id', ticket.payment_request_id)
        .single();

      if (request?.status === 'PAID') {
        const { data: claimed } = await this.db
          .from('pos_tickets')
          .update({ status: 'paid', paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', ticket.id)
          .eq('status', 'open')
          .select()
          .maybeSingle();

        if (claimed) {
          this.deductStockForTicket(claimed, callerId, callerRole, callerOrgId).catch((err) =>
            this.logger.error(`Stock deduction crashed for ticket ${claimed.id}: ${err.message}`),
          );
          return claimed;
        }
      }
    }

    return ticket;
  }

  /** Marks the ticket paid once confirmed payments cover the total — the
   * compare-and-swap on status='open' makes this safe to call from both the
   * cashier's own action and the poll-driven ScanLinkPay check. */
  private async settleIfFullyPaid(ticket: any, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    const payments = await this.getTicketPayments(ticket.id);
    const confirmed = payments.filter((p) => p.status === 'confirmed');
    const paidSum = confirmed.reduce((sum, p) => sum + p.amount_cents, 0);

    if (paidSum < ticket.total_cents || ticket.total_cents <= 0) return ticket;

    const methods = [...new Set(confirmed.map((p) => p.method))];
    const { data: claimed } = await this.db
      .from('pos_tickets')
      .update({
        status: 'paid',
        payment_method: methods.length > 1 ? 'mixed' : methods[0],
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', ticket.id)
      .eq('status', 'open')
      .select()
      .maybeSingle();

    if (!claimed) return ticket; // someone else already settled it

    // Stock deduction is a best-effort side effect (it already swallows
    // per-line failures) — don't make the cashier wait for its ~5 DB
    // round-trips PER ITEM before the receipt shows. It settles in the
    // background right after the response goes out.
    this.deductStockForTicket(claimed, callerId, callerRole, callerOrgId).catch((err) =>
      this.logger.error(`Stock deduction crashed for ticket ${claimed.id}: ${err.message}`),
    );
    return claimed;
  }

  private async deductStockForTicket(ticket: any, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    const items = await this.getTicketItems(ticket.id);
    // Parallel per-line deductions — sequential awaits made checkout take
    // several seconds on multi-line tickets (each movement is a handful of
    // DB round-trips of its own).
    await Promise.all(
      items.filter((i) => i.status === 'active').map(async (item) => {
        try {
          await this.stockService.createMovement(ticket.merchant_id, item.stock_item_id, callerId, callerRole, callerOrgId, {
            type: 'sale',
            quantity_delta: -item.quantity,
            reason: `Vente ticket ${ticket.ticket_number ? `#${ticket.ticket_number}` : ticket.id}`,
          });
        } catch (err: any) {
          // Never block a confirmed sale on a stock hiccup (e.g. the item was
          // deleted after the ticket was built) — log and move on, same
          // "best-effort side effect" philosophy as the low-stock notification
          // inside createMovement() itself.
          this.logger.error(`Stock deduction failed for ticket ${ticket.id}, item ${item.stock_item_id}: ${err.message}`);
        }
      }),
    );
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
        .select('id, name, unit_price_cents, cost_price_cents, currency, quantity')
        .eq('id', data.stock_item_id)
        .eq('merchant_id', merchantId)
        .single();
      stockItem = item;
    }

    if (!stockItem) throw new NotFoundException('Produit introuvable dans cette boutique');
    if (stockItem.currency !== ticket.currency) {
      throw new BadRequestException(`Cet article est en ${stockItem.currency}, le ticket est en ${ticket.currency}.`);
    }

    // Scanning/adding the same product twice merges into the existing active
    // line instead of stacking duplicate rows on the receipt.
    const items = await this.getTicketItems(ticketId);
    const existing = items.find((i) => i.stock_item_id === stockItem.id && i.status === 'active');
    const newQty = (existing?.quantity || 0) + data.quantity;

    if (stockItem.quantity < newQty) {
      throw new BadRequestException(`Stock insuffisant : il ne reste que ${stockItem.quantity} unité(s).`);
    }

    if (existing) {
      const { error } = await this.db
        .from('pos_ticket_items')
        .update({ quantity: newQty, line_total_cents: stockItem.unit_price_cents * newQty })
        .eq('id', existing.id);
      if (error) throw new Error(`Failed to update ticket item: ${error.message}`);
    } else {
      const { error } = await this.db.from('pos_ticket_items').insert({
        ticket_id: ticketId,
        stock_item_id: stockItem.id,
        product_name_snapshot: stockItem.name,
        quantity: data.quantity,
        unit_price_cents_snapshot: stockItem.unit_price_cents,
        cost_price_cents_snapshot: stockItem.cost_price_cents ?? null,
        line_total_cents: stockItem.unit_price_cents * data.quantity,
      });
      if (error) throw new Error(`Failed to add ticket item: ${error.message}`);
    }

    await this.recomputeTotals(ticket);
    return this.getTicket(merchantId, ticketId, callerId, callerRole, callerOrgId);
  }

  /** "Annulation de lignes avec autorisation" — the line is VOIDED (kept on
   * the ticket, excluded from totals) rather than deleted, so the receipt
   * and the audit trail both show what happened. Staff callers must have a
   * second employee type their own till PIN to authorize; the org owner and
   * platform admins void freely. */
  async voidItem(
    merchantId: string,
    ticketId: string,
    itemRowId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    data: { reason?: string; supervisor_pin?: string },
  ) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    const ticket = await this.getOwnTicket(merchantId, ticketId);
    if (ticket.status !== 'open') {
      throw new BadRequestException('Ce ticket est déjà clôturé.');
    }

    const items = await this.getTicketItems(ticketId);
    const line = items.find((i) => i.id === itemRowId);
    if (!line || line.status !== 'active') {
      throw new NotFoundException('Ligne introuvable sur ce ticket');
    }

    let authorizedBy: string | null = null;
    if (STAFF_JOB_ROLES.includes(callerRole)) {
      if (!callerOrgId) throw new ForbiddenException('Compte employé sans organisation associée.');
      if (!data.supervisor_pin) {
        throw new BadRequestException("Un code PIN d'un autre employé est requis pour autoriser l'annulation.");
      }
      authorizedBy = await this.cashierPinService.verifyOtherStaffPin(callerOrgId, data.supervisor_pin, callerId);
    }

    const { error } = await this.db
      .from('pos_ticket_items')
      .update({
        status: 'voided',
        voided_by: callerId,
        void_authorized_by: authorizedBy,
        voided_reason: data.reason || null,
        voided_at: new Date().toISOString(),
      })
      .eq('id', itemRowId);
    if (error) throw new Error(`Failed to void ticket item: ${error.message}`);

    await this.recomputeTotals(ticket);
    await this.auditService.log({
      user_id: callerId,
      action: 'pos_line_voided',
      entity_type: 'pos_ticket',
      entity_id: ticketId,
      changes: {
        product: line.product_name_snapshot,
        quantity: line.quantity,
        amount_cents: line.line_total_cents,
        reason: data.reason || null,
        authorized_by: authorizedBy,
      },
    });

    return this.getTicket(merchantId, ticketId, callerId, callerRole, callerOrgId);
  }

  /** Change a line's quantity in place (+/− steppers on the till). Same
   * guardrails as addItem for increases; dropping to zero is NOT allowed
   * here — that's a void, which goes through voidItem's authorization
   * flow instead. */
  async updateItemQuantity(
    merchantId: string,
    ticketId: string,
    itemRowId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    quantity: number,
  ) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    const ticket = await this.getOwnTicket(merchantId, ticketId);
    if (ticket.status !== 'open') {
      throw new BadRequestException('Ce ticket est déjà clôturé.');
    }

    const items = await this.getTicketItems(ticketId);
    const line = items.find((i) => i.id === itemRowId);
    if (!line || line.status !== 'active') {
      throw new NotFoundException('Ligne introuvable sur ce ticket');
    }

    const { data: stockItem } = await this.db
      .from('stock_items')
      .select('quantity, unit_price_cents')
      .eq('id', line.stock_item_id)
      .single();
    if (!stockItem) throw new NotFoundException('Produit introuvable dans cette boutique');

    if (quantity > stockItem.quantity) {
      throw new BadRequestException(`Stock insuffisant : il ne reste que ${stockItem.quantity} unité(s).`);
    }

    const { error } = await this.db
      .from('pos_ticket_items')
      .update({ quantity, line_total_cents: stockItem.unit_price_cents * quantity })
      .eq('id', itemRowId);
    if (error) throw new Error(`Failed to update ticket item: ${error.message}`);

    await this.recomputeTotals(ticket);
    return this.getTicket(merchantId, ticketId, callerId, callerRole, callerOrgId);
  }

  /** Park / resume a ticket — the cashier puts a sale on hold (e.g. customer
   * forgot their wallet) and picks it back up later from the held list. */
  async setHeld(
    merchantId: string,
    ticketId: string,
    held: boolean,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    note?: string,
  ) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    const ticket = await this.getOwnTicket(merchantId, ticketId);
    if (ticket.status !== 'open') {
      throw new BadRequestException('Seul un ticket en cours peut être mis en attente ou repris.');
    }

    const { data: updated, error } = await this.db
      .from('pos_tickets')
      .update({
        is_held: held,
        hold_note: held ? note || null : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', ticketId)
      .select()
      .single();
    if (error) throw new Error(`Failed to update ticket: ${error.message}`);
    return updated;
  }

  /** Remaining amount still to tender: total minus confirmed payments AND
   * pending ScanLinkPay parts (that QR is already spoken for). */
  private remainingCents(ticket: any, payments: any[]) {
    const spokenFor = payments.reduce((sum, p) => sum + p.amount_cents, 0);
    return ticket.total_cents - spokenFor;
  }

  /** Cash payment — full or partial (a part can stay for ScanLinkPay).
   * received_cents is what the customer handed over, for change display. */
  async payCash(
    merchantId: string,
    ticketId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    data: { amount_cents?: number; received_cents?: number } = {},
  ) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    // Ticket + payments fetches don't depend on each other — run them together.
    const [ticket, payments] = await Promise.all([
      this.getOwnTicket(merchantId, ticketId),
      this.getTicketPayments(ticketId),
    ]);
    if (ticket.status !== 'open') {
      throw new BadRequestException('Ce ticket est déjà clôturé.');
    }

    const remaining = this.remainingCents(ticket, payments);
    const amount = data.amount_cents ?? remaining;

    if (remaining <= 0) throw new BadRequestException('Ce ticket est déjà entièrement réglé.');
    if (amount <= 0 || amount > remaining) {
      throw new BadRequestException(`Montant invalide — reste à payer : ${remaining / 100} ${ticket.currency}.`);
    }
    if (data.received_cents !== undefined && data.received_cents < amount) {
      throw new BadRequestException('Le montant remis est inférieur à la part en espèces.');
    }

    const { error } = await this.db.from('pos_ticket_payments').insert({
      ticket_id: ticketId,
      method: 'cash',
      amount_cents: amount,
      received_cents: data.received_cents ?? amount,
      status: 'confirmed',
      created_by: callerId,
    });
    if (error) throw new Error(`Failed to record cash payment: ${error.message}`);

    // settleIfFullyPaid returns the claimed (paid) ticket — enrich it
    // directly instead of re-running access checks + a full re-fetch.
    const settled = await this.settleIfFullyPaid(ticket, callerId, callerRole, callerOrgId);
    return this.withDetails(settled);
  }

  /** ScanLinkPay payment — full or the remaining part after a cash part.
   * The payment row stays 'pending' until the customer actually pays the
   * linked payment_request (see trySettleScanlinkpayTicket). */
  async payScanlinkpay(
    merchantId: string,
    ticketId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    data: { amount_cents?: number } = {},
  ) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    const ticket = await this.getOwnTicket(merchantId, ticketId);
    if (ticket.status !== 'open') {
      throw new BadRequestException('Ce ticket est déjà clôturé.');
    }

    const payments = await this.getTicketPayments(ticketId);
    const existingPending = payments.find((p) => p.method === 'scanlinkpay' && p.status === 'pending');
    if (existingPending) {
      // Already minted — return the existing QR instead of a duplicate.
      const { data: existing } = await this.db
        .from('payment_requests')
        .select('*')
        .eq('id', existingPending.payment_request_id)
        .single();
      return { ticket: await this.withDetails(ticket), payment_request: existing };
    }

    const remaining = this.remainingCents(ticket, payments);
    const amount = data.amount_cents ?? remaining;
    if (remaining <= 0) throw new BadRequestException('Ce ticket est déjà entièrement réglé.');
    if (amount <= 0 || amount > remaining) {
      throw new BadRequestException(`Montant invalide — reste à payer : ${remaining / 100} ${ticket.currency}.`);
    }

    const request = await this.paymentRequestsService.createPaymentRequest(merchantId, undefined, {
      amount_cents: amount,
      currency: ticket.currency,
      description: `Ticket POS ${ticket.ticket_number ? `#${ticket.ticket_number}` : ticketId.slice(0, 8)}`,
    });

    const { error } = await this.db.from('pos_ticket_payments').insert({
      ticket_id: ticketId,
      method: 'scanlinkpay',
      amount_cents: amount,
      status: 'pending',
      payment_request_id: request.id,
      created_by: callerId,
    });
    if (error) throw new Error(`Failed to record ScanLinkPay payment: ${error.message}`);

    // Kept in sync for backward compatibility with anything still reading
    // pos_tickets.payment_request_id (the legacy settle path included).
    await this.db
      .from('pos_tickets')
      .update({ payment_request_id: request.id, updated_at: new Date().toISOString() })
      .eq('id', ticketId);

    return { ticket: await this.getTicket(merchantId, ticketId, callerId, callerRole, callerOrgId), payment_request: request };
  }

  /** Drop a pending ScanLinkPay part — the minted QR can't be un-minted,
   * but removing the payment row frees the amount for another method (the
   * linked payment_request just expires unpaid). Only 'pending' rows can
   * go: a confirmed payment is real money already in. */
  async voidPayment(merchantId: string, ticketId: string, paymentId: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    const ticket = await this.getOwnTicket(merchantId, ticketId);
    if (ticket.status !== 'open') {
      throw new BadRequestException('Ce ticket est déjà clôturé.');
    }

    const payments = await this.getTicketPayments(ticketId);
    const payment = payments.find((p) => p.id === paymentId);
    if (!payment) throw new NotFoundException('Paiement introuvable sur ce ticket');
    if (payment.status !== 'pending') {
      throw new BadRequestException('Seul un paiement ScanLinkPay en attente peut être retiré.');
    }

    const { error } = await this.db.from('pos_ticket_payments').delete().eq('id', paymentId);
    if (error) throw new Error(`Failed to void payment: ${error.message}`);

    if (ticket.payment_request_id === payment.payment_request_id) {
      await this.db.from('pos_tickets').update({ payment_request_id: null, updated_at: new Date().toISOString() }).eq('id', ticketId);
    }

    await this.auditService.log({
      user_id: callerId,
      action: 'pos_payment_voided',
      entity_type: 'pos_ticket',
      entity_id: ticketId,
      changes: { method: payment.method, amount_cents: payment.amount_cents },
    });

    return this.getTicket(merchantId, ticketId, callerId, callerRole, callerOrgId);
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

    // A pending ScanLinkPay QR could still be paid by the customer after the
    // cancel — refusing while any payment row exists avoids a paid-cancelled
    // limbo (money in, no stock out, no receipt).
    const payments = await this.getTicketPayments(ticketId);
    if (payments.length) {
      throw new BadRequestException('Ce ticket a déjà un paiement enregistré — il ne peut plus être annulé.');
    }

    const { data: updated, error } = await this.db
      .from('pos_tickets')
      .update({
        status: 'cancelled',
        is_held: false,
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

  /** Store-level POS settings — for now just the TVA rate (16% default).
   * Restricted to the owner/admin: staff sells, they don't set tax policy. */
  async getSettings(merchantId: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    const merchant = await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    return { pos_tva_rate_pct: Number(merchant.pos_tva_rate_pct ?? 0) };
  }

  async updateSettings(
    merchantId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    data: { tva_rate_pct: number },
  ) {
    await this.stockService.resolveMerchantAccess(merchantId, callerId, callerRole, callerOrgId, []);
    if (data.tva_rate_pct < 0 || data.tva_rate_pct > 100) {
      throw new BadRequestException('Le taux de TVA doit être entre 0 et 100.');
    }

    const { error } = await this.db
      .from('merchants')
      .update({ pos_tva_rate_pct: data.tva_rate_pct })
      .eq('id', merchantId);
    if (error) throw new Error(`Failed to update POS settings: ${error.message}`);

    await this.auditService.log({
      user_id: callerId,
      action: 'pos_tva_rate_changed',
      entity_type: 'merchant',
      entity_id: merchantId,
      changes: { tva_rate_pct: data.tva_rate_pct },
    });

    return { pos_tva_rate_pct: data.tva_rate_pct };
  }
}
