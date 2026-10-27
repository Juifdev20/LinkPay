import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { StockService } from '../stock/stock.service';
import { CashUnlockService } from './cash-unlock.service';
import { CashDayLockService } from './cash-day-lock.service';
import { CASH_READ_ROLES, CASH_WRITE_ROLES } from './cash-roles';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { requireStaffStation, stationStaffWithRoles } from '../common/org-access';
import { trustedNow } from '../common/utils/trusted-clock';
import {
  addDaysToKey,
  businessDayKey,
  businessDayRange,
  businessMonthRange,
  businessPeriodRange,
  dayKeysOf,
  type BusinessRange,
  type ReportPeriodKind,
} from '../common/utils/business-day';

/**
 * Caisse de station — the cash book of one station (one store of the organization).
 *
 * Bookkeeping only: it READS sales, till movements and expenses, and records the count the cashier
 * makes at the end of the day. It never writes to ledger_entries or a wallet and never moves money.
 *
 * What is "in the drawer" (cash) — all per currency, never CDF + USD together:
 *   receipts  = cash paid on till tickets + cash paid on Ventes sales + manual cash-in
 *   payments  = station expenses APPROVED by the manager (dated at the approval) + manual cash-out; a pending expense is not an outflow yet
 * ScanLinkPay / wallet sales are listed apart: that money never enters the drawer.
 * Opening of a day = the counted cash of the last closed day (0 before the first closing, unless the
 * first closing declares it). Days are closed in order.
 */
export { CASH_READ_ROLES, CASH_WRITE_ROLES };
const CURRENCIES = ['CDF', 'USD'];
const PAGE = 1000;
const CHUNK = 400;

export type CashEntryKind = 'sale' | 'cash_in' | 'expense' | 'cash_out' | 'adjustment';

export interface CashEntry {
  id: string;
  at: string;
  day: string;
  kind: CashEntryKind;
  direction: 'in' | 'out';
  amount_cents: number;
  label: string;
  ref: string | null;
  by_id: string | null;
  by: string | null;
  status?: string | null;
  category?: string | null;
  balance_cents?: number;
}

export interface NonCashSale {
  id: string;
  at: string;
  day: string;
  label: string;
  method: string;
  amount_cents: number;
  by_id: string | null;
}

interface Loaded {
  entries: CashEntry[];
  non_cash: NonCashSale[];
  sales_count: number;
}

const sum = (rows: { amount_cents: number }[]) => rows.reduce((s, r) => s + r.amount_cents, 0);

@Injectable()
export class CashBookService {
  private readonly logger = new Logger(CashBookService.name);

  constructor(
    private supabaseService: SupabaseService,
    private stockService: StockService,
    private auditService: AuditService,
    private notificationsService: NotificationsService,
    private unlock?: CashUnlockService,
    private lock?: CashDayLockService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  // ------------------------------------------------------------------ access

  private async access(merchantId: string, callerId: string, callerRole: string, callerOrgId: string | undefined, write: boolean) {
    const merchant = await this.stockService.resolveMerchantAccess(merchantId, callerId, callerRole, callerOrgId, write ? CASH_WRITE_ROLES : CASH_READ_ROLES);
    const isManager = this.isManager(merchant, callerId, callerRole);
    return { merchant, isManager };
  }

  /** The owner, the station manager and platform admins validate expenses and reopen days. */
  private isManager(merchant: any, callerId: string, callerRole: string) {
    return merchant.owner_id === callerId || ['gerant', 'enterprise', 'admin', 'super_admin'].includes(callerRole);
  }

  private assertCurrency(currency: string) {
    if (!CURRENCIES.includes(currency)) throw new BadRequestException('Devise invalide (CDF ou USD).');
  }

  private assertDay(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new BadRequestException('Date invalide (AAAA-MM-JJ).');
  }

  private today() {
    return businessDayKey(trustedNow());
  }

  // ------------------------------------------------------------------ reading the station's cash

  private async fetchAll(page: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>): Promise<any[]> {
    const out: any[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await page(from, from + PAGE - 1);
      if (error) throw new Error(`Failed to load the cash book: ${error.message}`);
      out.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
    return out;
  }

  private async namesOf(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean) as string[])];
    const names = new Map<string, string>();
    for (let i = 0; i < unique.length; i += CHUNK) {
      const { data } = await this.db.from('profiles').select('id, full_name, email').in('id', unique.slice(i, i + CHUNK));
      for (const p of data || []) names.set(p.id, (p.full_name || p.email || '').replace(/\s+/g, ' ').trim());
    }
    return names;
  }

  /** Names of the sellers / cashiers assigned to the station: the signatories of its reports. */
  private async cashiersOf(merchantId: string): Promise<string[]> {
    const ids = await stationStaffWithRoles(this.db, merchantId, ['caissier', 'vendeur']);
    const names = await this.namesOf(ids);
    return ids.map((id) => names.get(id)).filter(Boolean) as string[];
  }

  /** A closing row with the names of the people who closed / reopened it (for the printed receipt). */
  private async withClosingNames<T extends { closed_by?: string | null; reopened_by?: string | null }>(rows: T[]): Promise<(T & { closed_by_name: string | null; reopened_by_name: string | null })[]> {
    const names = await this.namesOf(rows.flatMap((r) => [r.closed_by, r.reopened_by]));
    return rows.map((r) => ({ ...r, closed_by_name: (r.closed_by && names.get(r.closed_by)) || null, reopened_by_name: (r.reopened_by && names.get(r.reopened_by)) || null }));
  }

  /** Everything that touched the station's drawer (and its non-cash sales) over [from, to). */
  private async loadEntries(merchantId: string, currency: string, range: { from: Date; to: Date }): Promise<Loaded> {
    const from = range.from.toISOString();
    const to = range.to.toISOString();

    const [tickets, sales, movements, expenses] = await Promise.all([
      this.fetchAll((a, b) => this.db.from('pos_tickets')
        .select('id, ticket_number, total_cents, payment_method, paid_at, cashier_user_id')
        .eq('merchant_id', merchantId).eq('status', 'paid').eq('currency', currency)
        .gte('paid_at', from).lt('paid_at', to).order('paid_at', { ascending: true }).range(a, b)),
      this.fetchAll((a, b) => this.db.from('sales')
        .select('id, reference, total_cents, payment_method, paid_at, created_by')
        .eq('merchant_id', merchantId).eq('status', 'PAID').eq('currency', currency)
        .gte('paid_at', from).lt('paid_at', to).order('paid_at', { ascending: true }).range(a, b)),
      this.fetchAll((a, b) => this.db.from('cash_movements')
        .select('id, type, amount_cents, reason, created_by, created_at, cash_register_sessions!inner(merchant_id, currency)')
        .eq('cash_register_sessions.merchant_id', merchantId).eq('cash_register_sessions.currency', currency)
        .gte('created_at', from).lt('created_at', to).order('created_at', { ascending: true }).range(a, b)),
      this.fetchAll((a, b) => this.db.from('organization_expenses')
        .select('id, amount_cents, description, category, status, created_by, created_at, approved_at')
        .eq('merchant_id', merchantId).eq('currency', currency).eq('status', 'approved')
        .or(`and(approved_at.gte.${from},approved_at.lt.${to}),and(approved_at.is.null,created_at.gte.${from},created_at.lt.${to})`)
        .order('created_at', { ascending: true }).range(a, b)),
    ]);

    // Cash share of each till ticket: its confirmed cash payments; tickets without payment rows are all-or-nothing.
    const cashOfTicket = new Map<string, number>();
    const hasRows = new Set<string>();
    const ids = tickets.map((t: any) => t.id);
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data } = await this.db.from('pos_ticket_payments').select('ticket_id, method, amount_cents, status').in('ticket_id', ids.slice(i, i + CHUNK));
      for (const p of data || []) {
        hasRows.add(p.ticket_id);
        if (p.method === 'cash' && p.status === 'confirmed') cashOfTicket.set(p.ticket_id, (cashOfTicket.get(p.ticket_id) || 0) + (p.amount_cents || 0));
      }
    }

    const names = await this.namesOf([
      ...tickets.map((t: any) => t.cashier_user_id),
      ...sales.map((s: any) => s.created_by),
      ...movements.map((m: any) => m.created_by),
      ...expenses.map((e: any) => e.created_by),
    ]);
    const who = (id: string | null) => (id ? names.get(id) || null : null);

    const entries: CashEntry[] = [];
    const nonCash: NonCashSale[] = [];
    const methodLabel = (m: string) => (m === 'cash' ? 'Espèces' : m === 'scanlinkpay' || m === 'wallet' ? 'ScanLinkPay' : m === 'mobile_money' ? 'Mobile Money' : m || '—');

    for (const t of tickets) {
      const cash = hasRows.has(t.id) ? cashOfTicket.get(t.id) || 0 : t.payment_method === 'cash' ? t.total_cents : 0;
      const label = `Ticket #${t.ticket_number ?? '—'}`;
      if (cash > 0) {
        entries.push({ id: `t:${t.id}`, at: t.paid_at, day: businessDayKey(t.paid_at), kind: 'sale', direction: 'in', amount_cents: cash, label, ref: label, by_id: t.cashier_user_id, by: who(t.cashier_user_id) });
      }
      const other = Math.max(0, (t.total_cents || 0) - cash);
      if (other > 0) {
        nonCash.push({ id: `t:${t.id}`, at: t.paid_at, day: businessDayKey(t.paid_at), label, method: methodLabel(t.payment_method === 'cash' ? 'scanlinkpay' : t.payment_method), amount_cents: other, by_id: t.cashier_user_id });
      }
    }
    for (const s of sales) {
      const label = s.reference || 'Vente';
      if (s.payment_method === 'cash') {
        entries.push({ id: `s:${s.id}`, at: s.paid_at, day: businessDayKey(s.paid_at), kind: 'sale', direction: 'in', amount_cents: s.total_cents, label, ref: s.reference || null, by_id: s.created_by, by: who(s.created_by) });
      } else {
        nonCash.push({ id: `s:${s.id}`, at: s.paid_at, day: businessDayKey(s.paid_at), label, method: methodLabel(s.payment_method), amount_cents: s.total_cents, by_id: s.created_by });
      }
    }
    for (const m of movements) {
      const isIn = m.type === 'cash_in';
      entries.push({
        id: `m:${m.id}`, at: m.created_at, day: businessDayKey(m.created_at), kind: isIn ? 'cash_in' : 'cash_out', direction: isIn ? 'in' : 'out',
        amount_cents: m.amount_cents, label: m.reason || (isIn ? 'Entrée de caisse' : 'Sortie de caisse'), ref: null, by_id: m.created_by, by: who(m.created_by),
      });
    }
    for (const e of expenses) {
      // The money leaves the drawer when the manager approves, not when the seller wrote the expense down.
      const at = e.approved_at || e.created_at;
      entries.push({
        id: `e:${e.id}`, at, day: businessDayKey(at), kind: 'expense', direction: 'out', amount_cents: e.amount_cents,
        label: e.description || e.category || 'Dépense', ref: null, by_id: e.created_by, by: who(e.created_by), status: e.status || 'approved', category: e.category || null,
      });
    }
    entries.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    nonCash.sort((a, b) => a.at.localeCompare(b.at));
    return { entries, non_cash: nonCash, sales_count: tickets.length + sales.length };
  }

  private totals(entries: CashEntry[]) {
    const byKind = (k: CashEntryKind) => sum(entries.filter((e) => e.kind === k));
    const cash_sales = byKind('sale');
    const cash_in = byKind('cash_in');
    const expenses = byKind('expense');
    const cash_out = byKind('cash_out');
    return { cash_sales_cents: cash_sales, cash_in_cents: cash_in, expenses_cents: expenses, cash_out_cents: cash_out, receipts_cents: cash_sales + cash_in, payments_cents: expenses + cash_out };
  }

  /** Counted cash of the last closed day before `day` (0 before the first closing). */
  private async openingFor(merchantId: string, currency: string, day: string): Promise<{ opening_cents: number; from_day: string | null }> {
    const { data } = await this.db.from('cash_day_closings')
      .select('business_day, counted_cents')
      .eq('merchant_id', merchantId).eq('currency', currency).eq('status', 'closed').lt('business_day', day)
      .order('business_day', { ascending: false }).limit(1);
    const last = (data || [])[0];
    return { opening_cents: last ? Number(last.counted_cents) : 0, from_day: last ? last.business_day : null };
  }

  private async closingOf(merchantId: string, currency: string, day: string) {
    const { data } = await this.db.from('cash_day_closings').select('*').eq('merchant_id', merchantId).eq('currency', currency).eq('business_day', day).maybeSingle();
    return data || null;
  }

  /**
   * The earliest day before `day` that has cash activity but was never closed. Before any closing exists, the latest
   * active day of the last week is the baseline that must be closed first (the first closing declares its opening).
   */
  private async earliestUnclosedDay(merchantId: string, currency: string, day: string): Promise<string | null> {
    const { from_day } = await this.openingFor(merchantId, currency, day);
    if (!from_day) {
      if (!this.lock) return null;
      const baseline = await this.lock.earliestUnclosedPastDay(merchantId, currency, this.today());
      return baseline && baseline < day ? baseline : null;
    }
    const start = addDaysToKey(from_day, 1);
    if (start >= day) return null;
    const range = { from: businessDayRange(start).from, to: businessDayRange(day).from };
    const loaded = await this.loadEntries(merchantId, currency, range);
    const days = [...new Set([...loaded.entries.map((e) => e.day), ...loaded.non_cash.map((n) => n.day)])].sort();
    return days[0] || null;
  }

  /** A till session left open only blocks the closing where the station really sells at a till (supermarkets, food shops). */
  private async openSessionExists(merchantId: string, currency: string, organizationId?: string | null) {
    if (organizationId) {
      const { data: org } = await this.db.from('organizations').select('sector').eq('id', organizationId).maybeSingle();
      if (!['supermarche', 'alimentation'].includes(org?.sector)) return false;
    }
    const { data } = await this.db.from('cash_register_sessions').select('id').eq('merchant_id', merchantId).eq('currency', currency).eq('status', 'open').limit(1);
    return !!(data && data.length);
  }

  // ------------------------------------------------------------------ day view

  async dayView(merchantId: string, date: string | undefined, currency: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    const { merchant, isManager } = await this.access(merchantId, callerId, callerRole, callerOrgId, false);
    this.assertCurrency(currency);
    const day = date || this.today();
    this.assertDay(day);

    const loaded = await this.loadEntries(merchantId, currency, businessDayRange(day));
    const { opening_cents } = await this.openingFor(merchantId, currency, day);
    const t = this.totals(loaded.entries);
    const expected = opening_cents + t.receipts_cents - t.payments_cents;
    const closing = await this.closingOf(merchantId, currency, day);
    const closed = closing?.status === 'closed';

    let running = opening_cents;
    const entries = loaded.entries.map((e) => ({ ...e, balance_cents: (running += e.direction === 'in' ? e.amount_cents : -e.amount_cents) }));

    let blocked_by: string | null = null;
    if (!closed) {
      if (day > this.today()) blocked_by = 'future';
      else if (await this.openSessionExists(merchantId, currency, merchant.organization_id)) blocked_by = 'open_session';
      else {
        const earlier = await this.earliestUnclosedDay(merchantId, currency, day);
        if (earlier) blocked_by = `earlier_day:${earlier}`;
      }
    }
    const { data: pending } = await this.db.from('organization_expenses')
      .select('id, amount_cents, currency, description, category, created_by, created_at')
      .eq('merchant_id', merchantId).eq('status', 'pending').order('created_at', { ascending: true });
    const pendingNames = await this.namesOf((pending || []).map((p: any) => p.created_by));
    const pendingList = (pending || []).filter((p: any) => p.currency === currency).map((p: any) => ({
      id: p.id, amount_cents: p.amount_cents, description: p.description, category: p.category, at: p.created_at, by: pendingNames.get(p.created_by) || null,
    }));

    return {
      merchant: { id: merchant.id, name: merchant.name },
      day,
      currency,
      is_today: day === this.today(),
      opening_cents,
      ...t,
      expected_cents: expected,
      non_cash_cents: sum(loaded.non_cash),
      sales_count: loaded.sales_count,
      entries,
      non_cash: loaded.non_cash,
      closing: closing ? (await this.withClosingNames([closing]))[0] : null,
      closed,
      cashiers: await this.cashiersOf(merchantId),
      can_close: !closed && !blocked_by,
      blocked_by,
      can_manage: isManager,
      pending_expenses: (pending || []).length,
      pending_expenses_list: pendingList,
      previous_unclosed_day: !closed && day === this.today() ? await this.earliestUnclosedDay(merchantId, currency, day) : null,
      secret_set: this.unlock ? await this.unlock.hasSecret(callerId) : true,
    };
  }

  // ------------------------------------------------------------------ monthly cash book

  async monthBook(merchantId: string, month: string | undefined, currency: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    const { merchant } = await this.access(merchantId, callerId, callerRole, callerOrgId, false);
    this.assertCurrency(currency);
    const key = month || this.today().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) throw new BadRequestException('Mois invalide (AAAA-MM).');
    const range = businessMonthRange(key);

    const loaded = await this.loadEntries(merchantId, currency, range);
    const { data: closings } = await this.db.from('cash_day_closings').select('*').eq('merchant_id', merchantId).eq('currency', currency)
      .gte('business_day', range.first_day).lte('business_day', range.last_day);
    const closingByDay = new Map<string, any>((closings || []).map((c: any) => [c.business_day, c]));

    let opening = (await this.openingFor(merchantId, currency, range.first_day)).opening_cents;
    const openingOfMonth = opening;
    const today = this.today();
    const days: any[] = [];
    const unclosed_days: string[] = [];
    let receipts = 0;
    let payments = 0;
    let discrepancy = 0;

    for (const day of dayKeysOf(range)) {
      const dayEntries = loaded.entries.filter((e) => e.day === day);
      const closing = closingByDay.get(day);
      const closed = closing?.status === 'closed';
      if (!dayEntries.length && !closed) continue;
      const t = this.totals(dayEntries);
      const expected = opening + t.receipts_cents - t.payments_cents;
      let running = opening;
      const lines: CashEntry[] = dayEntries.map((e) => ({ ...e, balance_cents: (running += e.direction === 'in' ? e.amount_cents : -e.amount_cents) }));
      let closingBalance = expected;
      let gap = 0;
      if (closed) {
        gap = Number(closing.counted_cents) - expected;
        closingBalance = Number(closing.counted_cents);
        if (gap !== 0) {
          lines.push({
            id: `a:${closing.id}`, at: closing.closed_at, day, kind: 'adjustment', direction: gap > 0 ? 'in' : 'out', amount_cents: Math.abs(gap),
            label: gap > 0 ? 'Écart de caisse (excédent)' : 'Écart de caisse (manquant)', ref: null, by_id: closing.closed_by, by: null, balance_cents: closingBalance,
          });
        }
      } else if (day < today) {
        unclosed_days.push(day);
      }
      days.push({
        day, opening_cents: opening, entries: lines, ...t, expected_cents: expected, closing_cents: closingBalance,
        closed, discrepancy_cents: gap, closed_by: closing?.closed_by || null, closed_at: closing?.closed_at || null, note: closing?.note || null,
      });
      receipts += t.receipts_cents;
      payments += t.payments_cents;
      discrepancy += gap;
      opening = closingBalance;
    }

    return {
      merchant: { id: merchant.id, name: merchant.name },
      month: key,
      currency,
      first_day: range.first_day,
      last_day: range.last_day,
      opening_cents: openingOfMonth,
      closing_cents: opening,
      receipts_cents: receipts,
      payments_cents: payments,
      discrepancy_cents: discrepancy,
      non_cash_cents: sum(loaded.non_cash),
      days,
      unclosed_days,
      cashiers: await this.cashiersOf(merchantId),
    };
  }

  // ------------------------------------------------------------------ periodic report

  async report(merchantId: string, period: string, date: string | undefined, currency: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    const { merchant } = await this.access(merchantId, callerId, callerRole, callerOrgId, false);
    this.assertCurrency(currency);
    if (!['day', 'week', 'month', 'year'].includes(period)) throw new BadRequestException('Période invalide (day, week, month, year).');
    const anchor = date || this.today();
    this.assertDay(anchor);
    const range: BusinessRange = businessPeriodRange(period as ReportPeriodKind, anchor);
    return { merchant: { id: merchant.id, name: merchant.name }, cashiers: await this.cashiersOf(merchantId), ...(await this.buildReport(merchantId, currency, period as ReportPeriodKind, range)) };
  }

  /** Figures of a station over a calendar period (no access check). */
  async buildReport(merchantId: string, currency: string, period: ReportPeriodKind, range: BusinessRange) {
    const loaded = await this.loadEntries(merchantId, currency, range);
    const { data: closings } = await this.db.from('cash_day_closings').select('business_day, status, counted_cents, expected_cents, discrepancy_cents, closed_by')
      .eq('merchant_id', merchantId).eq('currency', currency).gte('business_day', range.first_day).lte('business_day', range.last_day);

    const t = this.totals(loaded.entries);
    const bucketOf = (day: string) => (period === 'year' ? day.slice(0, 7) : day);
    const buckets = new Map<string, { key: string; cash_sales_cents: number; non_cash_cents: number; expenses_cents: number; cash_in_cents: number; cash_out_cents: number }>();
    const bucket = (day: string) => {
      const k = bucketOf(day);
      if (!buckets.has(k)) buckets.set(k, { key: k, cash_sales_cents: 0, non_cash_cents: 0, expenses_cents: 0, cash_in_cents: 0, cash_out_cents: 0 });
      return buckets.get(k)!;
    };
    for (const k of period === 'year' ? [...new Set(dayKeysOf(range).map(bucketOf))] : dayKeysOf(range)) bucket(k.length === 7 ? `${k}-01` : k);
    for (const e of loaded.entries) {
      const b = bucket(e.day);
      if (e.kind === 'sale') b.cash_sales_cents += e.amount_cents;
      else if (e.kind === 'expense') b.expenses_cents += e.amount_cents;
      else if (e.kind === 'cash_in') b.cash_in_cents += e.amount_cents;
      else if (e.kind === 'cash_out') b.cash_out_cents += e.amount_cents;
    }
    for (const n of loaded.non_cash) bucket(n.day).non_cash_cents += n.amount_cents;

    const byCategory = new Map<string, number>();
    for (const e of loaded.entries.filter((x) => x.kind === 'expense')) byCategory.set(e.category || 'Autres', (byCategory.get(e.category || 'Autres') || 0) + e.amount_cents);
    const byMethod = new Map<string, number>([['Espèces', t.cash_sales_cents]]);
    for (const n of loaded.non_cash) byMethod.set(n.method, (byMethod.get(n.method) || 0) + n.amount_cents);
    const bySeller = new Map<string, { by_id: string | null; by: string | null; cash_cents: number; non_cash_cents: number }>();
    const seller = (id: string | null, name: string | null) => {
      const k = id || 'unknown';
      if (!bySeller.has(k)) bySeller.set(k, { by_id: id, by: name, cash_cents: 0, non_cash_cents: 0 });
      return bySeller.get(k)!;
    };
    for (const e of loaded.entries.filter((x) => x.kind === 'sale')) seller(e.by_id, e.by).cash_cents += e.amount_cents;
    const names = await this.namesOf(loaded.non_cash.map((n) => n.by_id));
    for (const n of loaded.non_cash) seller(n.by_id, n.by_id ? names.get(n.by_id) || null : null).non_cash_cents += n.amount_cents;

    const closedDays = new Set((closings || []).filter((c: any) => c.status === 'closed').map((c: any) => c.business_day));
    const activityDays = new Set([...loaded.entries.map((e) => e.day), ...loaded.non_cash.map((n) => n.day)]);
    const today = this.today();
    const unclosed_days = [...activityDays].filter((d) => d < today && !closedDays.has(d)).sort();
    const discrepancy = (closings || []).filter((c: any) => c.status === 'closed').reduce((s: number, c: any) => s + Number(c.discrepancy_cents || 0), 0);

    return {
      period,
      currency,
      first_day: range.first_day,
      last_day: range.last_day,
      ...t,
      net_cents: t.receipts_cents - t.payments_cents,
      non_cash_cents: sum(loaded.non_cash),
      turnover_cents: t.cash_sales_cents + sum(loaded.non_cash),
      sales_count: loaded.sales_count,
      average_ticket_cents: loaded.sales_count ? Math.round((t.cash_sales_cents + sum(loaded.non_cash)) / loaded.sales_count) : 0,
      series: [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key)),
      by_method: [...byMethod.entries()].map(([method, amount_cents]) => ({ method, amount_cents })).filter((m) => m.amount_cents > 0),
      by_category: [...byCategory.entries()].map(([category, amount_cents]) => ({ category, amount_cents })).sort((a, b) => b.amount_cents - a.amount_cents),
      by_seller: [...bySeller.values()].sort((a, b) => b.cash_cents + b.non_cash_cents - (a.cash_cents + a.non_cash_cents)),
      closings: (await this.withClosingNames(closings || [])).map((c: any) => ({ day: c.business_day, status: c.status, closed_by_name: c.closed_by_name, closed_at: c.closed_at, counted_cents: Number(c.counted_cents), expected_cents: Number(c.expected_cents), discrepancy_cents: Number(c.discrepancy_cents) })),
      discrepancy_cents: discrepancy,
      unclosed_days,
    };
  }

  // ------------------------------------------------------------------ closing a day

  async closeDay(
    merchantId: string,
    data: { date: string; currency: string; counted_cents: number; note?: string; opening_cents?: number },
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
  ) {
    const { merchant } = await this.access(merchantId, callerId, callerRole, callerOrgId, true);
    this.assertCurrency(data.currency);
    this.assertDay(data.date);
    if (!Number.isInteger(data.counted_cents) || data.counted_cents < 0) throw new BadRequestException('Montant compté invalide.');
    if (data.date > this.today()) throw new BadRequestException("Impossible de clôturer un jour qui n'est pas encore arrivé.");
    // The personal unlock code is mandatory: without it nobody could sell in an emergency after the closing.
    if (this.unlock && !(await this.unlock.hasSecret(callerId))) {
      throw new BadRequestException({ statusCode: 400, code: 'UNLOCK_SECRET_REQUIRED', message: 'Créez d’abord votre code secret de déverrouillage de caisse, puis clôturez la journée.' });
    }

    const existing = await this.closingOf(merchantId, data.currency, data.date);
    if (existing?.status === 'closed') throw new ConflictException('Cette journée est déjà clôturée.');
    if (await this.openSessionExists(merchantId, data.currency, merchant.organization_id)) {
      throw new BadRequestException("Une session de caisse est encore ouverte : fermez-la (comptage du tiroir) avant de clôturer la journée.");
    }
    const earlier = await this.earliestUnclosedDay(merchantId, data.currency, data.date);
    if (earlier) throw new BadRequestException(`Clôturez d'abord la journée du ${earlier}.`);

    const loaded = await this.loadEntries(merchantId, data.currency, businessDayRange(data.date));
    const opening = await this.openingFor(merchantId, data.currency, data.date);
    const openingCents = opening.from_day ? opening.opening_cents : Math.max(0, Math.round(data.opening_cents || 0));
    const t = this.totals(loaded.entries);
    const expected = openingCents + t.receipts_cents - t.payments_cents;
    const now = trustedNow().toISOString();

    const row = {
      organization_id: merchant.organization_id,
      merchant_id: merchantId,
      business_day: data.date,
      currency: data.currency,
      status: 'closed',
      version: (existing?.version || 0) + 1,
      opening_cents: openingCents,
      cash_sales_cents: t.cash_sales_cents,
      cash_in_cents: t.cash_in_cents,
      expenses_cents: t.expenses_cents,
      cash_out_cents: t.cash_out_cents,
      expected_cents: expected,
      counted_cents: data.counted_cents,
      discrepancy_cents: data.counted_cents - expected,
      non_cash_cents: sum(loaded.non_cash),
      sales_count: loaded.sales_count,
      note: data.note?.trim() || null,
      closed_by: callerId,
      closed_at: now,
    };

    const query = existing
      ? this.db.from('cash_day_closings').update(row).eq('id', existing.id).eq('status', 'reopened')
      : this.db.from('cash_day_closings').insert(row);
    const { data: saved, error } = await query.select().maybeSingle();
    if (error) {
      if (error.code === '23505') throw new ConflictException('Cette journée est déjà clôturée.');
      throw new Error(`Failed to close the day: ${error.message}`);
    }
    if (!saved) throw new ConflictException('Cette journée est déjà clôturée.');

    await this.auditService.log({
      user_id: callerId, action: 'cash_day_closed', entity_type: 'cash_day_closing', entity_id: saved.id,
      changes: { merchant_id: merchantId, day: data.date, currency: data.currency, expected_cents: expected, counted_cents: data.counted_cents, discrepancy_cents: row.discrepancy_cents },
    }).catch(() => undefined);
    await this.notifyClosing(merchant, saved, callerId).catch((err) => this.logger.warn(`Closing notice not sent: ${err?.message || err}`));
    return (await this.withClosingNames([saved]))[0];
  }

  async reopenDay(merchantId: string, closingId: string, reason: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    const { merchant, isManager } = await this.access(merchantId, callerId, callerRole, callerOrgId, true);
    if (!isManager) throw new ForbiddenException('Seul le gérant ou le patron peut rouvrir une journée clôturée.');
    if (!reason || reason.trim().length < 5) throw new BadRequestException('Indiquez le motif de la réouverture (5 caractères minimum).');

    const { data: row } = await this.db.from('cash_day_closings').select('*').eq('id', closingId).eq('merchant_id', merchantId).maybeSingle();
    if (!row) throw new NotFoundException('Clôture introuvable.');
    if (row.status !== 'closed') throw new BadRequestException("Cette journée n'est pas clôturée.");
    const { data: later } = await this.db.from('cash_day_closings').select('id').eq('merchant_id', merchantId).eq('currency', row.currency).eq('status', 'closed').gt('business_day', row.business_day).limit(1);
    if (later && later.length) throw new BadRequestException('Une journée plus récente est déjà clôturée : rouvrez-la d’abord, la plus récente en premier.');

    const { data: saved, error } = await this.db.from('cash_day_closings')
      .update({ status: 'reopened', reopened_by: callerId, reopened_at: trustedNow().toISOString(), reopen_reason: reason.trim() })
      .eq('id', closingId).eq('status', 'closed').select().maybeSingle();
    if (error) throw new Error(`Failed to reopen the day: ${error.message}`);
    if (!saved) throw new ConflictException('Cette journée vient déjà d’être rouverte.');

    await this.auditService.log({
      user_id: callerId, action: 'cash_day_reopened', entity_type: 'cash_day_closing', entity_id: closingId,
      changes: { merchant_id: merchantId, day: row.business_day, currency: row.currency, reason: reason.trim() },
    }).catch(() => undefined);
    if (row.closed_by && row.closed_by !== callerId) {
      await this.notificationsService.create({
        user_id: row.closed_by, type: 'cash_day_reopened', title: 'Journée de caisse rouverte',
        body: `${merchant.name} : la journée du ${row.business_day} a été rouverte (${reason.trim()}). Clôturez-la de nouveau après correction.`,
        data: { merchant_id: merchantId, day: row.business_day },
      }).catch(() => undefined);
    }
    return saved;
  }

  async listClosings(merchantId: string, from: string | undefined, to: string | undefined, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    await this.access(merchantId, callerId, callerRole, callerOrgId, false);
    let q = this.db.from('cash_day_closings').select('*').eq('merchant_id', merchantId).order('business_day', { ascending: false }).limit(366);
    if (from) q = q.gte('business_day', from);
    if (to) q = q.lte('business_day', to);
    const { data, error } = await q;
    if (error) throw new Error(`Failed to list closings: ${error.message}`);
    return this.withClosingNames(data || []);
  }

  // ------------------------------------------------------------------ archives (one binder per year)

  /**
   * The years the station has a binder for: from its oldest activity (or closing) in this currency to the current year,
   * with what its closed days add up to. Nothing is stored: it is all read from sales, till, expenses and closings.
   */
  async archive(merchantId: string, currency: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    const { merchant } = await this.access(merchantId, callerId, callerRole, callerOrgId, false);
    this.assertCurrency(currency);
    const oldest = async (q: PromiseLike<{ data: any[] | null }>, field: (r: any) => string | null | undefined) => {
      const { data } = await q;
      const v = field((data || [])[0] || {});
      return v ? businessDayKey(v) : null;
    };
    const [sale, ticket, movement, expense, closingsRes] = await Promise.all([
      oldest(this.db.from('sales').select('paid_at').eq('merchant_id', merchantId).eq('status', 'PAID').eq('currency', currency).not('paid_at', 'is', null).order('paid_at', { ascending: true }).limit(1), (r) => r.paid_at),
      oldest(this.db.from('pos_tickets').select('paid_at').eq('merchant_id', merchantId).eq('status', 'paid').eq('currency', currency).not('paid_at', 'is', null).order('paid_at', { ascending: true }).limit(1), (r) => r.paid_at),
      oldest(this.db.from('cash_movements').select('created_at, cash_register_sessions!inner(merchant_id, currency)').eq('cash_register_sessions.merchant_id', merchantId).eq('cash_register_sessions.currency', currency).order('created_at', { ascending: true }).limit(1), (r) => r.created_at),
      oldest(this.db.from('organization_expenses').select('created_at, approved_at').eq('merchant_id', merchantId).eq('currency', currency).eq('status', 'approved').order('created_at', { ascending: true }).limit(1), (r) => r.approved_at || r.created_at),
      this.db.from('cash_day_closings').select('business_day, status, cash_sales_cents, cash_in_cents, expenses_cents, cash_out_cents, discrepancy_cents').eq('merchant_id', merchantId).eq('currency', currency).eq('status', 'closed').order('business_day', { ascending: true }).limit(5000),
    ]);
    const closings = closingsRes.data || [];
    const today = this.today();
    const firstDay = [sale, ticket, movement, expense, closings[0]?.business_day].filter(Boolean).sort()[0] as string | undefined;
    const firstYear = firstDay ? Number(firstDay.slice(0, 4)) : Number(today.slice(0, 4));

    const years: { year: number; closed_days: number; receipts_cents: number; payments_cents: number; discrepancy_cents: number }[] = [];
    for (let year = Number(today.slice(0, 4)); year >= firstYear; year--) {
      const rows = closings.filter((c: any) => String(c.business_day).startsWith(`${year}-`));
      years.push({
        year,
        closed_days: rows.length,
        receipts_cents: rows.reduce((s: number, c: any) => s + Number(c.cash_sales_cents || 0) + Number(c.cash_in_cents || 0), 0),
        payments_cents: rows.reduce((s: number, c: any) => s + Number(c.expenses_cents || 0) + Number(c.cash_out_cents || 0), 0),
        discrepancy_cents: rows.reduce((s: number, c: any) => s + Number(c.discrepancy_cents || 0), 0),
      });
    }
    return { merchant: { id: merchant.id, name: merchant.name }, currency, first_day: firstDay || null, today, years };
  }

  /** Station figures of one day for the owner / accountant: which stations closed, which did not. */
  async overview(orgId: string, date: string | undefined, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    const { data: org } = await this.db.from('organizations').select('id, owner_id').eq('id', orgId).maybeSingle();
    if (!org) throw new NotFoundException('Organization not found');
    const isAdmin = ['admin', 'super_admin'].includes(callerRole);
    const isOwner = org.owner_id === callerId;
    const isStaff = callerOrgId === orgId && ['comptable', 'gerant'].includes(callerRole);
    if (!isAdmin && !isOwner && !isStaff) throw new ForbiddenException("Vous n'avez pas accès aux caisses de cette entreprise");
    const ownStation = !isAdmin && !isOwner ? await requireStaffStation(this.db, callerId, orgId) : null;
    const day = date || this.today();
    this.assertDay(day);

    let sq = this.db.from('merchants').select('id, name').eq('organization_id', orgId);
    if (ownStation) sq = sq.eq('id', ownStation);
    const { data: stations } = await sq;
    const ids = (stations || []).map((s: any) => s.id);
    const { data: closings } = ids.length ? await this.db.from('cash_day_closings').select('*').in('merchant_id', ids).eq('business_day', day) : { data: [] };
    const { data: pending } = ids.length ? await this.db.from('organization_expenses').select('merchant_id').in('merchant_id', ids).eq('status', 'pending') : { data: [] };
    return {
      day,
      stations: (stations || []).map((s: any) => ({
        merchant_id: s.id,
        merchant_name: s.name,
        closings: (closings || []).filter((c: any) => c.merchant_id === s.id),
        pending_expenses: (pending || []).filter((p: any) => p.merchant_id === s.id).length,
      })),
    };
  }

  // ------------------------------------------------------------------ station expenses

  async createExpense(
    merchantId: string,
    data: { amount_cents: number; currency: string; category: string; description: string },
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
  ) {
    const { merchant, isManager } = await this.access(merchantId, callerId, callerRole, callerOrgId, true);
    this.assertCurrency(data.currency);
    if (!Number.isInteger(data.amount_cents) || data.amount_cents <= 0) throw new BadRequestException('Montant invalide.');
    const category = (data.category || '').trim();
    const description = (data.description || '').trim();
    if (!category) throw new BadRequestException('Choisissez une catégorie.');
    if (description.length < 3) throw new BadRequestException('Indiquez le motif de la dépense.');

    const closing = await this.closingOf(merchantId, data.currency, this.today());
    if (closing?.status === 'closed') throw new ForbiddenException("La caisse du jour est clôturée : demandez au gérant ou au patron de la rouvrir.");
    const past = await this.earliestUnclosedDay(merchantId, data.currency, this.today());
    if (past) throw new ForbiddenException({ statusCode: 403, code: 'CASH_PREVIOUS_DAY_UNCLOSED', message: `Clôturez d'abord la caisse du ${past} avant de faire des opérations aujourd'hui.`, day: past, merchant_id: merchantId });

    const now = trustedNow().toISOString();
    const { data: expense, error } = await this.db.from('organization_expenses').insert({
      organization_id: merchant.organization_id,
      merchant_id: merchantId,
      amount_cents: data.amount_cents,
      currency: data.currency,
      description,
      category,
      created_by: callerId,
      created_at: now,
      status: isManager ? 'approved' : 'pending',
      ...(isManager ? { approved_by: callerId, approved_at: now } : {}),
    }).select().single();
    if (error) throw new Error(`Failed to record the expense: ${error.message}`);

    await this.auditService.log({
      user_id: callerId, action: 'station_expense_created', entity_type: 'organization_expense', entity_id: expense.id,
      changes: { merchant_id: merchantId, amount_cents: data.amount_cents, currency: data.currency, category, status: expense.status },
    }).catch(() => undefined);

    if (!isManager) {
      const recipients = await this.managersOf(merchant, callerId);
      await Promise.all(recipients.map((userId) => this.notificationsService.create({
        user_id: userId, type: 'station_expense_pending', title: 'Dépense à valider',
        body: `${merchant.name} : ${formatMoney(data.amount_cents, data.currency)} · ${category} — ${description}. Elle n'est déduite de la caisse qu'une fois validée.`,
        data: { merchant_id: merchantId, expense_id: expense.id },
      }).catch(() => undefined)));
    }
    return expense;
  }

  async listExpenses(merchantId: string, status: string | undefined, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    await this.access(merchantId, callerId, callerRole, callerOrgId, false);
    let q = this.db.from('organization_expenses')
      .select('id, amount_cents, currency, description, category, status, reject_reason, created_by, created_at, approved_at')
      .eq('merchant_id', merchantId).order('created_at', { ascending: false }).limit(100);
    if (status && ['pending', 'approved', 'rejected'].includes(status)) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw new Error(`Failed to list expenses: ${error.message}`);
    const names = await this.namesOf((data || []).map((e: any) => e.created_by));
    return (data || []).map((e: any) => ({ ...e, by: e.created_by ? names.get(e.created_by) || null : null }));
  }

  async reviewExpense(
    merchantId: string,
    expenseId: string,
    decision: 'approve' | 'reject',
    reason: string | undefined,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
  ) {
    const { merchant, isManager } = await this.access(merchantId, callerId, callerRole, callerOrgId, true);
    if (!isManager) throw new ForbiddenException('Seul le gérant ou le patron valide une dépense.');
    if (decision === 'reject' && (!reason || reason.trim().length < 3)) throw new BadRequestException('Indiquez le motif du rejet.');

    const { data: expense } = await this.db.from('organization_expenses').select('*').eq('id', expenseId).eq('merchant_id', merchantId).maybeSingle();
    if (!expense) throw new NotFoundException('Dépense introuvable.');
    if (expense.status !== 'pending') throw new BadRequestException('Cette dépense a déjà été traitée.');
    // An approved expense leaves the drawer today: today's cash must still be open (a rejection moves no money).
    if (decision === 'approve') {
      const closing = await this.closingOf(merchantId, expense.currency, this.today());
      if (closing?.status === 'closed') throw new ForbiddenException("La caisse du jour est clôturée : rouvrez-la avant de valider cette dépense (elle sortira de la caisse d'aujourd'hui).");
    }

    const now = trustedNow().toISOString();
    const patch = decision === 'approve'
      ? { status: 'approved', approved_by: callerId, approved_at: now, reject_reason: null }
      : { status: 'rejected', approved_by: callerId, approved_at: now, reject_reason: reason!.trim() };
    const { data: saved, error } = await this.db.from('organization_expenses').update(patch).eq('id', expenseId).eq('status', 'pending').select().maybeSingle();
    if (error) throw new Error(`Failed to review the expense: ${error.message}`);
    if (!saved) throw new ConflictException('Cette dépense vient déjà d’être traitée.');

    await this.auditService.log({
      user_id: callerId, action: decision === 'approve' ? 'station_expense_approved' : 'station_expense_rejected', entity_type: 'organization_expense', entity_id: expenseId,
      changes: { merchant_id: merchantId, amount_cents: expense.amount_cents, currency: expense.currency, reason: reason || null },
    }).catch(() => undefined);
    if (expense.created_by && expense.created_by !== callerId) {
      const amount = formatMoney(expense.amount_cents, expense.currency);
      const reviewer = (await this.namesOf([callerId])).get(callerId) || 'le gérant';
      const approve = decision === 'approve';
      await this.notificationsService.create({
        user_id: expense.created_by, type: approve ? 'station_expense_approved' : 'station_expense_rejected',
        title: approve ? 'Dépense validée — sortie de caisse' : 'Dépense rejetée — non déduite de la caisse',
        body: approve
          ? `${merchant.name} : votre dépense de ${amount} (${expense.description}) a été validée par ${reviewer}. Elle est maintenant une sortie : ${amount} sont déduits de la caisse.`
          : `${merchant.name} : votre dépense de ${amount} (${expense.description}) a été rejetée par ${reviewer} — ${reason!.trim()}. Rien n'est déduit de la caisse.`,
        data: { merchant_id: merchantId, expense_id: expenseId, decision },
      }).catch(() => undefined);
    }
    return saved;
  }

  // ------------------------------------------------------------------ notifications and reminders

  private async managersOf(merchant: any, exceptUserId?: string): Promise<string[]> {
    const { data: org } = merchant.organization_id
      ? await this.db.from('organizations').select('owner_id').eq('id', merchant.organization_id).maybeSingle()
      : { data: null };
    const managers = await stationStaffWithRoles(this.db, merchant.id, ['gerant']);
    return [...new Set([org?.owner_id || merchant.owner_id, ...managers].filter(Boolean))].filter((id) => id !== exceptUserId) as string[];
  }

  private async notifyClosing(merchant: any, closing: any, closedBy: string) {
    const recipients = await this.managersOf(merchant, closedBy);
    if (!recipients.length) return;
    const gap = Number(closing.discrepancy_cents || 0);
    const fmt = (c: number) => formatMoney(c, closing.currency);
    const body = `${merchant.name} · ${closing.business_day} : encaissé en espèces ${fmt(closing.cash_sales_cents + closing.cash_in_cents)}, dépenses ${fmt(closing.expenses_cents + closing.cash_out_cents)}. `
      + (gap === 0 ? 'Caisse juste.' : `Écart ${gap > 0 ? '+' : ''}${fmt(gap)} (attendu ${fmt(closing.expected_cents)}, compté ${fmt(closing.counted_cents)}).`);
    await Promise.all(recipients.map((userId) => this.notificationsService.create({
      user_id: userId, type: gap === 0 ? 'cash_day_closed' : 'cash_day_discrepancy', title: gap === 0 ? 'Caisse du jour clôturée' : 'Écart à la clôture de caisse',
      body, data: { merchant_id: merchant.id, day: closing.business_day, currency: closing.currency },
    }).catch(() => undefined)));
  }

  /** Evening reminder: stations that took cash today but have not closed the day. Returns how many were reminded. */
  async remindUnclosedStations(): Promise<number> {
    const day = this.today();
    const range = businessDayRange(day);
    const { data: stations } = await this.db.from('merchants').select('id, name, organization_id').not('organization_id', 'is', null);
    let reminded = 0;
    for (const merchant of stations || []) {
      for (const currency of CURRENCIES) {
        try {
          const closing = await this.closingOf(merchant.id, currency, day);
          if (closing?.status === 'closed') continue;
          const loaded = await this.loadEntries(merchant.id, currency, range);
          if (!loaded.entries.length && !loaded.non_cash.length) continue;
          const staff = await stationStaffWithRoles(this.db, merchant.id, ['caissier', 'vendeur', 'gerant']);
          await Promise.all(staff.map((userId) => this.notificationsService.create({
            user_id: userId, type: 'cash_day_unclosed', title: 'Caisse à clôturer',
            body: `${merchant.name} : la caisse du jour (${currency}) n'est pas encore clôturée.`,
            data: { merchant_id: merchant.id, day, currency },
          }).catch(() => undefined)));
          reminded++;
        } catch (err: any) {
          this.logger.warn(`Reminder skipped for ${merchant.id}: ${err?.message || err}`);
        }
      }
    }
    return reminded;
  }
}

function formatMoney(cents: number, currency: string) {
  const v = (cents || 0) / 100;
  return `${v.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${currency === 'USD' ? '$US' : currency}`;
}
