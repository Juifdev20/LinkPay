import { Injectable, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { StockService } from '../stock/stock.service';
import { OrganizationsService } from '../organizations/organizations.service';

/** Who reads a station's report, besides the owner: its manager and its accountant. */
export const REPORT_ROLES = ['gerant', 'comptable'];

// Same cap as PosStatsService: supabase-js can't GROUP BY, the aggregation is done here.
const TICKET_CAP = 20000;
const CHUNK = 400;

export interface ReportPeriod {
  from: string;
  to: string;
  currency: 'CDF' | 'USD';
}


/**
 * A station's till activity over a period, in one currency: sales by payment
 * method and by cashier, day by day, the cash sessions and their
 * discrepancies, the voided lines, the best products and the stock to watch.
 * It covers the till (POS); ScanLinkPay payments taken outside it (QR, card)
 * are in the Transactions screen.
 */
@Injectable()
export class ReportsService {
  constructor(
    private supabaseService: SupabaseService,
    private stockService: StockService,
    private organizationsService: OrganizationsService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  /** The report of one station — owner, or that station's manager / accountant. */
  async stationReport(merchantId: string, callerId: string, callerRole: string, callerOrgId: string | undefined, period: ReportPeriod) {
    const merchant = await this.stockService.resolveMerchantAccess(merchantId, callerId, callerRole, callerOrgId, REPORT_ROLES);
    return this.buildStationReport(merchant, period);
  }

  /** Every station of the business side by side — the owner only. */
  async organizationReport(orgId: string, callerId: string, period: ReportPeriod) {
    const org = await this.organizationsService.getOrganizationById(orgId);
    if (org.owner_id !== callerId) throw new ForbiddenException("Seul le responsable de l'entreprise voit toutes les stations");
    return this.buildOrganizationReport(orgId, period);
  }

  async buildOrganizationReport(orgId: string, period: ReportPeriod) {
    const stations = await this.organizationsService.getOrganizationMerchants(orgId);
    const reports = await Promise.all(stations.map((m) => this.buildStationReport(m, period)));
    const sum = (pick: (r: (typeof reports)[number]) => number) => reports.reduce((s, r) => s + pick(r), 0);
    return {
      ...period,
      stations: reports.map((r) => ({
        merchant_id: r.station.id,
        name: r.station.name,
        revenue_cents: r.totals.revenue_cents,
        tickets: r.totals.tickets,
        cash_cents: r.totals.by_method.cash || 0,
        scanlinkpay_cents: r.totals.by_method.scanlinkpay || 0,
        discrepancy_cents: r.sessions_total.discrepancy_cents,
        voids: r.voids_total.count,
        stock_alerts: r.stock_alerts.length,
      })),
      totals: {
        revenue_cents: sum((r) => r.totals.revenue_cents),
        tickets: sum((r) => r.totals.tickets),
        discrepancy_cents: sum((r) => r.sessions_total.discrepancy_cents),
        voids: sum((r) => r.voids_total.count),
        stock_alerts: sum((r) => r.stock_alerts.length),
      },
    };
  }

  /** No access check — callers check it (the controller, or the evening job). */
  async buildStationReport(merchant: { id: string; name: string }, period: ReportPeriod) {
    const { from, to, currency } = period;

    const [{ data: ticketRows }, { data: sessionRows }, { data: voidRows }, { data: stockRows }] = await Promise.all([
      this.db
        .from('pos_tickets')
        .select('id, total_cents, paid_at, cashier_user_id, payment_method')
        .eq('merchant_id', merchant.id)
        .eq('status', 'paid')
        .eq('currency', currency)
        .gte('paid_at', from)
        .lt('paid_at', to)
        .order('paid_at', { ascending: true })
        .limit(TICKET_CAP),
      this.db
        .from('cash_register_sessions')
        .select('id, cashier_user_id, status, opening_float_cents, expected_cents, closing_counted_cents, discrepancy_cents, opened_at, closed_at')
        .eq('merchant_id', merchant.id)
        .eq('currency', currency)
        .gte('opened_at', from)
        .lt('opened_at', to)
        .order('opened_at', { ascending: true }),
      this.db
        .from('pos_ticket_items')
        .select('product_name_snapshot, quantity, line_total_cents, voided_by, voided_reason, voided_at, ticket:pos_tickets!inner(merchant_id, currency, ticket_number)')
        .eq('status', 'voided')
        .eq('ticket.merchant_id', merchant.id)
        .eq('ticket.currency', currency)
        .gte('voided_at', from)
        .lt('voided_at', to)
        .order('voided_at', { ascending: false }),
      this.db
        .from('stock_items')
        .select('id, name, quantity, low_stock_threshold')
        .eq('merchant_id', merchant.id),
    ]);
    const tickets = ticketRows || [];
    const sessions = sessionRows || [];
    const voids = voidRows || [];

    // ---- Payments by method (a ticket can be paid partly cash, partly ScanLinkPay) ----
    const ticketIds = tickets.map((t) => t.id);
    const payments: any[] = [];
    const lines: any[] = [];
    for (let i = 0; i < ticketIds.length; i += CHUNK) {
      const ids = ticketIds.slice(i, i + CHUNK);
      const [{ data: p }, { data: l }] = await Promise.all([
        this.db.from('pos_ticket_payments').select('ticket_id, method, amount_cents').in('ticket_id', ids).eq('status', 'confirmed'),
        this.db.from('pos_ticket_items').select('ticket_id, product_name_snapshot, stock_item_id, quantity, line_total_cents').in('ticket_id', ids).eq('status', 'active'),
      ]);
      payments.push(...(p || []));
      lines.push(...(l || []));
    }
    const paidById = new Map<string, any[]>();
    for (const p of payments) paidById.set(p.ticket_id, [...(paidById.get(p.ticket_id) || []), p]);
    // Per ticket, what went to each method — older tickets have no payment rows: their method takes the total.
    const splitOf = (t: any): Record<string, number> => {
      const rows = paidById.get(t.id);
      if (!rows?.length) return { [t.payment_method || 'cash']: t.total_cents };
      const out: Record<string, number> = {};
      for (const r of rows) out[r.method] = (out[r.method] || 0) + r.amount_cents;
      return out;
    };

    const byMethod: Record<string, number> = {};
    const byDay: Record<string, { date: string; tickets: number; revenue_cents: number }> = {};
    const byCashier: Record<string, { user_id: string; tickets: number; revenue_cents: number; cash_cents: number; voids: number; discrepancy_cents: number }> = {};
    const cashierRow = (id: string) => (byCashier[id] ||= { user_id: id, tickets: 0, revenue_cents: 0, cash_cents: 0, voids: 0, discrepancy_cents: 0 });

    let revenue = 0;
    for (const t of tickets) {
      revenue += t.total_cents;
      const split = splitOf(t);
      for (const [m, v] of Object.entries(split)) byMethod[m] = (byMethod[m] || 0) + v;
      const day = (t.paid_at || '').slice(0, 10);
      byDay[day] ||= { date: day, tickets: 0, revenue_cents: 0 };
      byDay[day].tickets++;
      byDay[day].revenue_cents += t.total_cents;
      const c = cashierRow(t.cashier_user_id);
      c.tickets++;
      c.revenue_cents += t.total_cents;
      c.cash_cents += split.cash || 0;
    }
    for (const v of voids) if (v.voided_by) cashierRow(v.voided_by).voids++;
    for (const s of sessions) if (s.discrepancy_cents) cashierRow(s.cashier_user_id).discrepancy_cents += s.discrepancy_cents;

    // ---- Best products ----
    const products = new Map<string, { name: string; quantity: number; revenue_cents: number }>();
    for (const l of lines) {
      const key = l.stock_item_id || l.product_name_snapshot;
      const p = products.get(key) || { name: l.product_name_snapshot, quantity: 0, revenue_cents: 0 };
      p.quantity += l.quantity;
      p.revenue_cents += l.line_total_cents;
      products.set(key, p);
    }

    // ---- Names ----
    const people = await this.namesOf([
      ...tickets.map((t) => t.cashier_user_id),
      ...sessions.map((s) => s.cashier_user_id),
      ...voids.map((v) => v.voided_by),
    ]);
    const nameOf = (id?: string | null) => (id ? people.get(id) || 'Employé' : '—');

    const closed = sessions.filter((s) => s.status === 'closed');

    return {
      station: { id: merchant.id, name: merchant.name },
      ...period,
      totals: {
        tickets: tickets.length,
        revenue_cents: revenue,
        avg_basket_cents: tickets.length ? Math.round(revenue / tickets.length) : 0,
        by_method: byMethod,
      },
      daily: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)),
      by_cashier: Object.values(byCashier)
        .map((c) => ({ ...c, name: nameOf(c.user_id) }))
        .sort((a, b) => b.revenue_cents - a.revenue_cents),
      sessions: sessions.map((s) => ({ ...s, cashier_name: nameOf(s.cashier_user_id) })),
      sessions_total: {
        count: sessions.length,
        open: sessions.length - closed.length,
        discrepancy_cents: closed.reduce((sum, s) => sum + (s.discrepancy_cents || 0), 0),
        with_discrepancy: closed.filter((s) => s.discrepancy_cents).length,
      },
      voids: voids.slice(0, 200).map((v: any) => ({
        at: v.voided_at,
        ticket_number: v.ticket?.ticket_number ?? null,
        product: v.product_name_snapshot,
        quantity: v.quantity,
        amount_cents: v.line_total_cents,
        reason: v.voided_reason,
        by: nameOf(v.voided_by),
      })),
      voids_total: {
        count: voids.length,
        amount_cents: voids.reduce((sum, v) => sum + (v.line_total_cents || 0), 0),
      },
      top_products: [...products.values()].sort((a, b) => b.revenue_cents - a.revenue_cents).slice(0, 10),
      stock_alerts: (stockRows || [])
        .filter((i) => i.quantity <= (i.low_stock_threshold ?? 5))
        .sort((a, b) => a.quantity - b.quantity)
        .map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, threshold: i.low_stock_threshold })),
    };
  }

  private async namesOf(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))] as string[];
    if (!unique.length) return new Map();
    const { data } = await this.db.from('profiles').select('id, full_name, email').in('id', unique);
    return new Map((data || []).map((p) => [p.id, p.full_name || p.email || 'Employé']));
  }
}

export type StationReport = Awaited<ReturnType<ReportsService['buildStationReport']>>;
