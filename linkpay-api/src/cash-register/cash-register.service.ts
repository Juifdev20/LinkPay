import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { StockService, POS_SALE_ROLES } from '../stock/stock.service';
import { AuditService } from '../audit/audit.service';

/**
 * One open session per (store, currency) at a time — a till is opened with
 * a starting cash float, sales recorded against it, and closed by counting
 * the physical cash and comparing it to what the system expects
 * (float + cash sales + manual cash-in − manual cash-out).
 *
 * Cash sales are computed from pos_ticket_payments (method='cash',
 * status='confirmed') so a 'mixed' ticket still credits the drawer for its
 * cash part only; pre-034 tickets (paid directly, no payment rows) fall
 * back to their ticket total — never double-counted.
 */
@Injectable()
export class CashRegisterService {
  constructor(
    private supabaseService: SupabaseService,
    private stockService: StockService,
    private auditService: AuditService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  private async assertAccess(merchantId: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    return this.stockService.resolveMerchantAccess(merchantId, callerId, callerRole, callerOrgId, POS_SALE_ROLES);
  }

  async getCurrentSession(merchantId: string, currency: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);

    const { data } = await this.db
      .from('cash_register_sessions')
      .select('*')
      .eq('merchant_id', merchantId)
      .eq('currency', currency)
      .eq('status', 'open')
      .maybeSingle();

    return { session: data || null };
  }

  /** Past sessions, newest first — spec 1.3 "rapprochement" needs the
   * history to be reviewable, not just the live till. */
  async listSessions(
    merchantId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    filters: { page?: number; limit?: number },
  ) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);

    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 20, 100);

    const { data, error, count } = await this.db
      .from('cash_register_sessions')
      .select('*, cashier:profiles!cashier_user_id(full_name, email)', { count: 'exact' })
      .eq('merchant_id', merchantId)
      .order('opened_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (error) throw new Error(`Failed to list sessions: ${error.message}`);
    return { data: data || [], total: count || 0, page, limit };
  }

  /** Sum of cash actually taken during a session: confirmed 'cash' payment
   * rows (covers 'mixed' tickets correctly) + pre-034 tickets that have no
   * payment rows at all (fallback — never both, a new ticket always has its
   * payment row). */
  private async sessionCashSales(sessionId: string) {
    const { data: tickets } = await this.db
      .from('pos_tickets')
      .select('id, total_cents, payment_method')
      .eq('cash_register_session_id', sessionId)
      .eq('status', 'paid');

    const ids = (tickets || []).map((t) => t.id);
    let payments: { ticket_id: string; amount_cents: number }[] = [];
    if (ids.length) {
      const { data } = await this.db
        .from('pos_ticket_payments')
        .select('ticket_id, amount_cents')
        .in('ticket_id', ids)
        .eq('method', 'cash')
        .eq('status', 'confirmed');
      payments = data || [];
    }

    const withRows = new Set(payments.map((p) => p.ticket_id));
    let cash = payments.reduce((sum, p) => sum + p.amount_cents, 0);
    for (const t of tickets || []) {
      if (t.payment_method === 'cash' && !withRows.has(t.id)) cash += t.total_cents;
    }
    return cash;
  }

  /** Session detail: movements + tickets of the session + a live expected
   * amount (computed the same way as at closing, so the drawer can be
   * checked mid-shift too). */
  async getSessionDetail(merchantId: string, sessionId: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    const session = await this.getOwnSession(merchantId, sessionId);

    const [{ data: movements }, { data: tickets }, cashSales] = await Promise.all([
      this.db.from('cash_movements').select('*').eq('session_id', sessionId).order('created_at', { ascending: true }),
      this.db
        .from('pos_tickets')
        .select('*, payments:pos_ticket_payments(*)')
        .eq('cash_register_session_id', sessionId)
        .order('created_at', { ascending: false }),
      this.sessionCashSales(sessionId),
    ]);

    const cashIn = (movements || []).filter((m) => m.type === 'cash_in').reduce((sum, m) => sum + m.amount_cents, 0);
    const cashOut = (movements || []).filter((m) => m.type === 'cash_out').reduce((sum, m) => sum + m.amount_cents, 0);
    const expected = session.opening_float_cents + cashSales + cashIn - cashOut;

    return {
      ...session,
      movements: movements || [],
      tickets: tickets || [],
      cash_sales_cents: cashSales,
      expected_cents: session.status === 'closed' ? session.expected_cents : expected,
    };
  }

  async openSession(
    merchantId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    data: { currency: string; opening_float_cents: number },
  ) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);

    const existing = await this.db
      .from('cash_register_sessions')
      .select('id')
      .eq('merchant_id', merchantId)
      .eq('currency', data.currency)
      .eq('status', 'open')
      .maybeSingle();

    if (existing.data) {
      throw new BadRequestException(`Une session de caisse en ${data.currency} est déjà ouverte pour cette boutique.`);
    }

    const { data: session, error } = await this.db
      .from('cash_register_sessions')
      .insert({
        merchant_id: merchantId,
        cashier_user_id: callerId,
        currency: data.currency,
        opening_float_cents: data.opening_float_cents,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to open cash register session: ${error.message}`);

    await this.auditService.log({
      user_id: callerId,
      action: 'cash_session_opened',
      entity_type: 'cash_register_session',
      entity_id: session.id,
      changes: { currency: data.currency, opening_float_cents: data.opening_float_cents },
    });

    return session;
  }

  private async getOwnSession(merchantId: string, sessionId: string) {
    const { data, error } = await this.db
      .from('cash_register_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('merchant_id', merchantId)
      .single();

    if (error || !data) throw new NotFoundException('Session de caisse introuvable');
    return data;
  }

  async addMovement(
    merchantId: string,
    sessionId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    data: { type: 'cash_in' | 'cash_out'; amount_cents: number; reason?: string },
  ) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    const session = await this.getOwnSession(merchantId, sessionId);
    if (session.status !== 'open') {
      throw new BadRequestException('Cette session de caisse est déjà clôturée.');
    }

    const { data: movement, error } = await this.db
      .from('cash_movements')
      .insert({
        session_id: sessionId,
        type: data.type,
        amount_cents: data.amount_cents,
        reason: data.reason || null,
        created_by: callerId,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to record cash movement: ${error.message}`);
    return movement;
  }

  async closeSession(
    merchantId: string,
    sessionId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    data: { closing_counted_cents: number },
  ) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    const session = await this.getOwnSession(merchantId, sessionId);
    if (session.status !== 'open') {
      throw new BadRequestException('Cette session de caisse est déjà clôturée.');
    }

    const { data: movements } = await this.db
      .from('cash_movements')
      .select('type, amount_cents')
      .eq('session_id', sessionId);

    const cashSales = await this.sessionCashSales(sessionId);
    const cashIn = (movements || []).filter((m) => m.type === 'cash_in').reduce((sum, m) => sum + m.amount_cents, 0);
    const cashOut = (movements || []).filter((m) => m.type === 'cash_out').reduce((sum, m) => sum + m.amount_cents, 0);
    const expected = session.opening_float_cents + cashSales + cashIn - cashOut;
    const discrepancy = data.closing_counted_cents - expected;

    const { data: closed, error } = await this.db
      .from('cash_register_sessions')
      .update({
        status: 'closed',
        closing_counted_cents: data.closing_counted_cents,
        expected_cents: expected,
        discrepancy_cents: discrepancy,
        closed_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .eq('status', 'open')
      .select()
      .single();

    if (error || !closed) throw new BadRequestException('Cette session de caisse est déjà clôturée.');

    await this.auditService.log({
      user_id: callerId,
      action: 'cash_session_closed',
      entity_type: 'cash_register_session',
      entity_id: sessionId,
      changes: { expected_cents: expected, closing_counted_cents: data.closing_counted_cents, discrepancy_cents: discrepancy },
    });

    return closed;
  }
}
