import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger, Optional } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { StockService, POS_SALE_ROLES } from '../stock/stock.service';
import { AuditService } from '../audit/audit.service';
import { OWN_TILL_ONLY_ROLES, stationStaffWithRoles } from '../common/org-access';
import { NotificationsService } from '../notifications/notifications.service';
import { CashDayLockService } from '../cash-book/cash-day-lock.service';

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
    private notificationsService: NotificationsService,
    @Optional() private cashDayLock?: CashDayLockService,
  ) {}

  private readonly logger = new Logger(CashRegisterService.name);

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

    let query = this.db
      .from('cash_register_sessions')
      .select('*', { count: 'exact' })
      .eq('merchant_id', merchantId);
    if (OWN_TILL_ONLY_ROLES.includes(callerRole)) query = query.eq('cashier_user_id', callerId);
    const { data, error, count } = await query
      .order('opened_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (error) throw new Error(`Failed to list sessions: ${error.message}`);

    // cashier_user_id references auth.users, not profiles, so PostgREST can't
    // embed the cashier: look the names up in a second query.
    const cashierIds = [...new Set((data || []).map((s) => s.cashier_user_id).filter(Boolean))];
    const { data: cashiers } = cashierIds.length
      ? await this.db.from('profiles').select('id, full_name, email').in('id', cashierIds)
      : { data: [] as { id: string; full_name: string | null; email: string | null }[] };
    const byId = new Map((cashiers || []).map((c) => [c.id, { full_name: c.full_name, email: c.email }]));

    return {
      data: (data || []).map((s) => ({ ...s, cashier: byId.get(s.cashier_user_id) || null })),
      total: count || 0,
      page,
      limit,
    };
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
    // A cashier may check the live till, but not a colleague's past shift.
    if (OWN_TILL_ONLY_ROLES.includes(callerRole) && session.status !== 'open' && session.cashier_user_id !== callerId) {
      throw new ForbiddenException("Cette session de caisse n'est pas la vôtre");
    }

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
    // The till of a closed day stays shut: unlock the day first.
    await this.cashDayLock?.assertDayOpen(merchantId, data.currency);

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

  private async movementByClientRef(sessionId: string, clientRef: string) {
    const { data, error } = await this.db.from('cash_movements').select('*').eq('session_id', sessionId).eq('client_ref', clientRef).maybeSingle();
    return error ? null : data;
  }

  async addMovement(
    merchantId: string,
    sessionId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    data: { type: 'cash_in' | 'cash_out'; amount_cents: number; reason?: string; client_ref?: string },
  ) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    const session = await this.getOwnSession(merchantId, sessionId);
    // Made offline and already received (answer lost): give back the first one.
    if (data.client_ref) {
      const existing = await this.movementByClientRef(sessionId, data.client_ref);
      if (existing) return existing;
    }
    if (session.status !== 'open') {
      throw new BadRequestException('Cette session de caisse est déjà clôturée.');
    }
    await this.cashDayLock?.assertDayOpen(merchantId, session.currency);

    const row: Record<string, unknown> = {
      session_id: sessionId,
      type: data.type,
      amount_cents: data.amount_cents,
      reason: data.reason || null,
      created_by: callerId,
    };
    if (data.client_ref) row.client_ref = data.client_ref;
    let { data: movement, error } = await this.db.from('cash_movements').insert(row).select().single();
    if (error && data.client_ref && (error as any).code === '23505') {
      const existing = await this.movementByClientRef(sessionId, data.client_ref);
      if (existing) return existing;
    }
    if (error && data.client_ref && /client_ref/.test(error.message)) {
      this.logger.warn('cash_movements.client_ref missing — run migration 075');
      delete row.client_ref;
      ({ data: movement, error } = await this.db.from('cash_movements').insert(row).select().single());
    }

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
    const merchant = await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
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

    await this.notifyClosure(merchant, closed, cashSales, callerId).catch((err) =>
      this.logger.warn(`Closure notice not sent for session ${sessionId}: ${err?.message || err}`),
    );

    return closed;
  }

  /**
   * End of a shift: the station manager(s) and the owner are told what the
   * till took and whether the count matched — "Écart de caisse" when it
   * didn't. Best effort: closing the till never depends on it.
   */
  private async notifyClosure(merchant: any, session: any, cashSales: number, closedBy: string) {
    const { data: tickets } = await this.db
      .from('pos_tickets')
      .select('total_cents')
      .eq('cash_register_session_id', session.id)
      .eq('status', 'paid');
    const sales = (tickets || []).reduce((sum, t) => sum + (t.total_cents || 0), 0);

    const { data: cashier } = await this.db.from('profiles').select('full_name, email').eq('id', session.cashier_user_id).maybeSingle();
    const { data: org } = merchant.organization_id
      ? await this.db.from('organizations').select('owner_id').eq('id', merchant.organization_id).maybeSingle()
      : { data: null };
    const managers = await stationStaffWithRoles(this.db, merchant.id, ['gerant']);
    const recipients = [...new Set([org?.owner_id || merchant.owner_id, ...managers].filter(Boolean))].filter((id) => id !== closedBy);
    if (!recipients.length) return;

    const c = session.currency;
    const fmt = (cents: number) => formatMoney(cents, c);
    const gap = session.discrepancy_cents || 0;
    const who = cashier?.full_name || cashier?.email || 'Un caissier';
    const body = `${who} · ${merchant.name} : ${tickets?.length || 0} ticket(s), ventes ${fmt(sales)}, espèces ${fmt(cashSales)}. `
      + (gap === 0 ? 'Caisse juste.' : `Écart ${gap > 0 ? '+' : ''}${fmt(gap)} (attendu ${fmt(session.expected_cents)}, compté ${fmt(session.closing_counted_cents)}).`);

    await Promise.all(recipients.map((userId) => this.notificationsService.create({
      user_id: userId,
      type: gap === 0 ? 'cash_session_closed' : 'cash_discrepancy',
      title: gap === 0 ? 'Clôture de caisse' : 'Écart de caisse',
      body,
      data: { merchant_id: merchant.id, session_id: session.id },
    }).catch(() => undefined)));
  }
}

/** "12 500 FC" / "12.50 $" — for notification texts (amounts are in cents). */
function formatMoney(cents: number, currency: string) {
  const units = (cents || 0) / 100;
  return currency === 'USD'
    ? `${units.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`
    : `${Math.round(units).toLocaleString('fr-FR')} FC`;
}
