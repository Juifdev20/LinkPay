import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { StockService } from '../stock/stock.service';

// Who can see sales stats — the direction roles (owner/enterprise and
// platform admin pass resolveMerchantAccess regardless), plus 'comptable'
// whose whole job is following the numbers.
const STATS_ROLES = ['comptable'];

// Hard cap on rows pulled into memory for the JS-side aggregation —
// supabase-js can't GROUP BY, and a supermarket's ticket volume over a
// quarter stays well under this in practice.
const TICKET_CAP = 20000;
const ITEM_CHUNK = 400;

/**
 * Sales statistics for the store's POS (spec 3.1): revenue/TVA/margin
 * summaries, daily breakdown, top sellers and dead stock. Computed over
 * pos_ticket_items snapshots (cost_price_cents_snapshot added in 034) so
 * margins reflect the cost AT SALE TIME, not today's.
 */
@Injectable()
export class PosStatsService {
  constructor(
    private supabaseService: SupabaseService,
    private stockService: StockService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  private async assertAccess(merchantId: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    return this.stockService.resolveMerchantAccess(merchantId, callerId, callerRole, callerOrgId, STATS_ROLES);
  }

  private async paidTickets(merchantId: string, from: string, to: string, currency?: string) {
    let query = this.db
      .from('pos_tickets')
      .select('id, ticket_number, total_cents, subtotal_cents, tva_cents, payment_method, currency, paid_at')
      .eq('merchant_id', merchantId)
      .eq('status', 'paid')
      .gte('paid_at', from)
      .lte('paid_at', to)
      .order('paid_at', { ascending: true })
      .limit(TICKET_CAP);
    if (currency) query = query.eq('currency', currency);
    const { data } = await query;
    return data || [];
  }

  private async ticketItems(ticketIds: string[]) {
    const items: any[] = [];
    for (let i = 0; i < ticketIds.length; i += ITEM_CHUNK) {
      const { data } = await this.db
        .from('pos_ticket_items')
        .select('ticket_id, stock_item_id, product_name_snapshot, quantity, unit_price_cents_snapshot, cost_price_cents_snapshot, line_total_cents')
        .in('ticket_id', ticketIds.slice(i, i + ITEM_CHUNK))
        .eq('status', 'active');
      items.push(...(data || []));
    }
    return items;
  }

  private computeMargin(items: any[]) {
    let margin = 0;
    let marginableRevenue = 0;
    let totalRevenue = 0;
    for (const i of items) {
      totalRevenue += i.line_total_cents;
      if (i.cost_price_cents_snapshot !== null && i.cost_price_cents_snapshot !== undefined) {
        margin += (i.unit_price_cents_snapshot - i.cost_price_cents_snapshot) * i.quantity;
        marginableRevenue += i.line_total_cents;
      }
    }
    return { margin, marginableRevenue, totalRevenue };
  }

  async getSummary(
    merchantId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    filters: { from: string; to: string; currency?: string },
  ) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    const tickets = await this.paidTickets(merchantId, filters.from, filters.to, filters.currency);
    const items = await this.ticketItems(tickets.map((t) => t.id));

    const revenue = tickets.reduce((s, t) => s + t.total_cents, 0);
    const tva = tickets.reduce((s, t) => s + (t.tva_cents || 0), 0);
    const byMethod: Record<string, { count: number; amount_cents: number }> = {};
    for (const t of tickets) {
      const m = t.payment_method || 'cash';
      byMethod[m] = byMethod[m] || { count: 0, amount_cents: 0 };
      byMethod[m].count++;
      byMethod[m].amount_cents += t.total_cents;
    }

    const { margin, marginableRevenue } = this.computeMargin(items);

    return {
      from: filters.from,
      to: filters.to,
      currency: filters.currency || null,
      tickets_count: tickets.length,
      revenue_cents: revenue,
      tva_cents: tva,
      avg_basket_cents: tickets.length ? Math.round(revenue / tickets.length) : 0,
      margin_cents: margin,
      marginable_revenue_cents: marginableRevenue,
      margin_pct: marginableRevenue > 0 ? Math.round((margin / marginableRevenue) * 1000) / 10 : null,
      by_method: byMethod,
    };
  }

  async getDaily(
    merchantId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    filters: { from: string; to: string; currency?: string },
  ) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    const tickets = await this.paidTickets(merchantId, filters.from, filters.to, filters.currency);

    const byDay: Record<string, { date: string; tickets: number; revenue_cents: number }> = {};
    for (const t of tickets) {
      const day = (t.paid_at || '').slice(0, 10);
      byDay[day] = byDay[day] || { date: day, tickets: 0, revenue_cents: 0 };
      byDay[day].tickets++;
      byDay[day].revenue_cents += t.total_cents;
    }
    return Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
  }

  async getTopProducts(
    merchantId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    filters: { from: string; to: string; currency?: string; limit?: number },
  ) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    const tickets = await this.paidTickets(merchantId, filters.from, filters.to, filters.currency);
    const items = await this.ticketItems(tickets.map((t) => t.id));

    const byProduct = new Map<string, { stock_item_id: string; name: string; qty: number; revenue_cents: number; margin_cents: number }>();
    for (const i of items) {
      const key = i.stock_item_id;
      const entry = byProduct.get(key) || { stock_item_id: key, name: i.product_name_snapshot, qty: 0, revenue_cents: 0, margin_cents: 0 };
      entry.qty += i.quantity;
      entry.revenue_cents += i.line_total_cents;
      if (i.cost_price_cents_snapshot !== null && i.cost_price_cents_snapshot !== undefined) {
        entry.margin_cents += (i.unit_price_cents_snapshot - i.cost_price_cents_snapshot) * i.quantity;
      }
      byProduct.set(key, entry);
    }

    return [...byProduct.values()]
      .sort((a, b) => b.qty - a.qty || b.revenue_cents - a.revenue_cents)
      .slice(0, filters.limit || 10);
  }

  /** Dead stock — products on the shelf with zero POS sales over the period
   * (rotation lente), sorted by tied-up value so the worst offenders show
   * first. */
  async getDeadStock(
    merchantId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    filters: { from: string; to: string; currency?: string; limit?: number },
  ) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    const tickets = await this.paidTickets(merchantId, filters.from, filters.to);
    const items = await this.ticketItems(tickets.map((t) => t.id));
    const soldIds = new Set(items.map((i) => i.stock_item_id));

    let itemsQuery = this.db
      .from('stock_items')
      .select('id, name, category, quantity, unit_price_cents, cost_price_cents, currency')
      .eq('merchant_id', merchantId)
      .gt('quantity', 0);
    if (filters.currency) itemsQuery = itemsQuery.eq('currency', filters.currency);
    const { data: stock } = await itemsQuery;

    return (stock || [])
      .filter((i) => !soldIds.has(i.id))
      .map((i) => ({
        stock_item_id: i.id,
        name: i.name,
        category: i.category,
        quantity: i.quantity,
        unit_price_cents: i.unit_price_cents,
        currency: i.currency,
        tied_up_value_cents: i.quantity * (i.cost_price_cents ?? i.unit_price_cents),
      }))
      .sort((a, b) => b.tied_up_value_cents - a.tied_up_value_cents)
      .slice(0, filters.limit || 20);
  }
}
