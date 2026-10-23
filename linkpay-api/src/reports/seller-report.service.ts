import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { requireStaffStation } from '../common/org-access';
import { REPORT_ROLES } from './reports.service';

// supabase-js can't GROUP BY: rows are summed here, within the same caps as the station report.
const ROW_CAP = 20000;
const CHUNK = 400;

type Caller = { id: string; role?: string; organization_id?: string };
type Money = Record<string, number>;

const add = (m: Money, currency: string, cents: number) => {
  m[currency] = (m[currency] || 0) + cents;
};

export interface SellerRow {
  user_id: string;
  name: string;
  /** Till tickets (supermarket) and Ventes sales (electronics) — one figure, both counted. */
  sales_count: number;
  till_tickets: number;
  module_sales: number;
  units: number;
  revenue: Money;
  /** On the lines whose purchase price is known; `revenue_with_cost` is the revenue those lines stand for. */
  margin: Money;
  revenue_with_cost: Money;
}

/**
 * Sales per seller over a period chosen by its start and end date (DECISIONS.md 23/10, A3), for every sector at once:
 * the till of the supermarket (`pos_tickets`, by cashier) and the Ventes of the electronics shop (`sales`, by the
 * seller who made it). Only what was paid. Amounts stay per currency — never added across CDF and USD.
 * The owner sees every station (or one); a station's manager or accountant, their station.
 */
@Injectable()
export class SellerReportService {
  constructor(
    private supabaseService: SupabaseService,
    private organizationsService: OrganizationsService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  async report(orgId: string, caller: Caller, period: { from: string; to: string }, merchantId?: string) {
    if (Date.parse(period.to) <= Date.parse(period.from)) throw new BadRequestException('La date de fin doit suivre la date de début.');
    const org = await this.organizationsService.getOrganizationById(orgId);
    const stations = await this.organizationsService.getOrganizationMerchants(orgId);
    const isAdmin = caller.role === 'admin' || caller.role === 'super_admin';
    let stationIds: string[];
    if (isAdmin || org.owner_id === caller.id) {
      stationIds = merchantId ? stations.filter((s) => s.id === merchantId).map((s) => s.id) : stations.map((s) => s.id);
      if (merchantId && !stationIds.length) throw new BadRequestException("Cette station n'appartient pas à l'entreprise");
    } else {
      if (caller.organization_id !== orgId || !REPORT_ROLES.includes(caller.role || '')) {
        throw new ForbiddenException("Le rapport des vendeurs est réservé au patron, au gérant et au comptable");
      }
      stationIds = [await requireStaffStation(this.db, caller.id, orgId)];
    }

    const rows = new Map<string, SellerRow>();
    const row = (id: string) => {
      let r = rows.get(id);
      if (!r) {
        r = { user_id: id, name: '', sales_count: 0, till_tickets: 0, module_sales: 0, units: 0, revenue: {}, margin: {}, revenue_with_cost: {} };
        rows.set(id, r);
      }
      return r;
    };

    let truncated = false;
    if (stationIds.length) {
      // ---- The till (supermarket & food) ----
      const { data: tickets } = await this.db
        .from('pos_tickets')
        .select('id, cashier_user_id, total_cents, currency')
        .in('merchant_id', stationIds)
        .eq('status', 'paid')
        .gte('paid_at', period.from)
        .lt('paid_at', period.to)
        .limit(ROW_CAP);
      const ticketList = tickets || [];
      if (ticketList.length >= ROW_CAP) truncated = true;
      const sellerOfTicket = new Map<string, { seller: string; currency: string }>();
      for (const t of ticketList) {
        if (!t.cashier_user_id) continue;
        const r = row(t.cashier_user_id);
        r.till_tickets++;
        r.sales_count++;
        add(r.revenue, t.currency, t.total_cents);
        sellerOfTicket.set(t.id, { seller: t.cashier_user_id, currency: t.currency });
      }
      const ids = [...sellerOfTicket.keys()];
      for (let i = 0; i < ids.length; i += CHUNK) {
        const { data: lines } = await this.db
          .from('pos_ticket_items')
          .select('ticket_id, quantity, line_total_cents, cost_price_cents_snapshot')
          .in('ticket_id', ids.slice(i, i + CHUNK))
          .eq('status', 'active');
        for (const l of lines || []) {
          const owner = sellerOfTicket.get(l.ticket_id);
          if (!owner) continue;
          const r = row(owner.seller);
          r.units += l.quantity;
          if (l.cost_price_cents_snapshot != null) {
            add(r.margin, owner.currency, l.line_total_cents - l.cost_price_cents_snapshot * l.quantity);
            add(r.revenue_with_cost, owner.currency, l.line_total_cents);
          }
        }
      }

      // ---- Ventes (electronics) ----
      const { data: sales } = await this.db
        .from('sales')
        .select('id, created_by, total_cents, currency, sale_items(quantity, unit_price_cents, unit_cost_cents)')
        .eq('organization_id', orgId)
        .in('merchant_id', stationIds)
        .eq('status', 'PAID')
        .gte('paid_at', period.from)
        .lt('paid_at', period.to)
        .limit(ROW_CAP);
      const saleList = sales || [];
      if (saleList.length >= ROW_CAP) truncated = true;
      for (const s of saleList) {
        if (!s.created_by) continue;
        const r = row(s.created_by);
        r.module_sales++;
        r.sales_count++;
        add(r.revenue, s.currency, s.total_cents);
        for (const l of (s.sale_items as any[]) || []) {
          r.units += l.quantity;
          // A sale line records 0 when the product had no purchase price: unknown, not free.
          if (l.unit_cost_cents > 0) {
            add(r.margin, s.currency, (l.unit_price_cents - l.unit_cost_cents) * l.quantity);
            add(r.revenue_with_cost, s.currency, l.unit_price_cents * l.quantity);
          }
        }
      }
    }

    // ---- Names ----
    const userIds = [...rows.keys()];
    if (userIds.length) {
      const { data: people } = await this.db.from('profiles').select('id, full_name, email').in('id', userIds);
      const names = new Map((people || []).map((p: any) => [p.id, p.full_name || p.email]));
      for (const r of rows.values()) r.name = names.get(r.user_id) || 'Employé';
    }

    const sellers = [...rows.values()].sort((a, b) => b.sales_count - a.sales_count);
    const totals = { sales_count: 0, units: 0, revenue: {} as Money, margin: {} as Money, revenue_with_cost: {} as Money };
    for (const r of sellers) {
      totals.sales_count += r.sales_count;
      totals.units += r.units;
      for (const [c, v] of Object.entries(r.revenue)) add(totals.revenue, c, v);
      for (const [c, v] of Object.entries(r.margin)) add(totals.margin, c, v);
      for (const [c, v] of Object.entries(r.revenue_with_cost)) add(totals.revenue_with_cost, c, v);
    }
    const stationName = merchantId ? stations.find((s) => s.id === merchantId)?.name ?? null : stationIds.length === 1 ? stations.find((s) => s.id === stationIds[0])?.name ?? null : null;
    return { from: period.from, to: period.to, station: stationName, sellers, totals, truncated };
  }
}
