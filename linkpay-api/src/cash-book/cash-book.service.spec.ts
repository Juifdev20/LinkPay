import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';
import { CashBookService } from './cash-book.service';

const NOW = new Date('2026-10-22T10:00:00Z').getTime(); // Thursday 22 October 2026, noon in Kasindi
const MERCHANT = { id: 'st1', name: 'Station Kasindi', organization_id: 'org1', owner_id: 'boss' };

type Data = {
  tickets?: any[];
  payments?: any[];
  sales?: any[];
  movements?: any[];
  expenses?: any[];
  closings?: any[];
  openSession?: boolean;
  sector?: string;
};

/** Rows whose `field` lies in the [gte, lt) window the query asked for. */
function within(rows: any[], field: string, q: RecordedQuery) {
  const gte = q.calls.find((c) => c.method === 'gte' && c.args[0] === field)?.args[1];
  const lt = q.calls.find((c) => c.method === 'lt' && c.args[0] === field)?.args[1];
  return rows.filter((r) => (!gte || r[field] >= gte) && (!lt || r[field] < lt));
}

function setup(data: Data = {}, mutate?: (q: RecordedQuery) => any) {
  const closings = data.closings || [];
  const fake = createFakeSupabase((q) => {
    const custom = mutate?.(q);
    if (custom) return custom;
    switch (q.target) {
      case 'pos_tickets': return { data: within(data.tickets || [], 'paid_at', q) };
      case 'pos_ticket_payments': return { data: data.payments || [] };
      case 'sales': return { data: within(data.sales || [], 'paid_at', q) };
      case 'cash_movements': return { data: within(data.movements || [], 'created_at', q) };
      case 'organization_expenses': {
        const write = q.calls.find((c) => c.method === 'insert' || c.method === 'update');
        if (write) return { data: { id: 'e-new', ...write.args[0] } };
        const eqStatus = q.calls.find((c) => c.method === 'eq' && c.args[0] === 'status')?.args[1];
        const rows = (data.expenses || []).filter((e) => (e.status || 'approved') === eqStatus);
        if (eqStatus === 'pending') return { data: rows.map((e) => ({ currency: 'CDF', ...e })) };
        // An approved expense falls on the day of its approval (created_at for older ones).
        const or = q.calls.find((c) => c.method === 'or')?.args[0] as string | undefined;
        const m = or?.match(/approved_at\.gte\.([^,)]+),approved_at\.lt\.([^,)]+)/);
        return { data: m ? rows.filter((e) => { const at = e.approved_at || e.created_at; return at >= m[1] && at < m[2]; }) : rows };
      }
      case 'cash_register_sessions': return { data: data.openSession ? [{ id: 's1' }] : [] };
      case 'profiles': return { data: [{ id: 'u1', full_name: 'Alice', email: 'a@x.cd' }] };
      case 'cash_day_closings': {
        const eq = (k: string) => q.calls.find((c) => c.method === 'eq' && c.args[0] === k)?.args[1];
        const lt = q.calls.find((c) => c.method === 'lt' && c.args[0] === 'business_day')?.args[1];
        const gt = q.calls.find((c) => c.method === 'gt' && c.args[0] === 'business_day')?.args[1];
        let rows = closings.filter((c) => (!eq('status') || c.status === eq('status')) && (!eq('business_day') || c.business_day === eq('business_day')));
        if (lt) rows = rows.filter((c) => c.business_day < lt);
        if (gt) rows = rows.filter((c) => c.business_day > gt);
        rows = [...rows].sort((a, b) => b.business_day.localeCompare(a.business_day));
        const single = q.calls.some((c) => c.method === 'maybeSingle');
        if (q.calls.some((c) => c.method === 'insert' || c.method === 'update')) return { data: { id: 'c-new', ...(q.calls.find((c) => c.method === 'insert' || c.method === 'update')!.args[0]) } };
        return { data: single ? rows[0] || null : rows };
      }
      case 'organizations': return { data: { owner_id: 'boss', sector: data.sector ?? 'supermarche' } };
      case 'organization_staff': return { data: [] };
      default: return { data: null };
    }
  });
  const stock = { resolveMerchantAccess: jest.fn().mockResolvedValue(MERCHANT) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const notifications = { create: jest.fn().mockResolvedValue(undefined) };
  const service = new CashBookService(fake.service, stock as any, audit as any, notifications as any);
  return { service, fake, stock, audit, notifications };
}

const DAY = {
  tickets: [
    { id: 't1', ticket_number: 7, total_cents: 10000, payment_method: 'cash', paid_at: '2026-10-22T08:00:00Z', cashier_user_id: 'u1' },
    { id: 't2', ticket_number: 8, total_cents: 5000, payment_method: 'scanlinkpay', paid_at: '2026-10-22T09:00:00Z', cashier_user_id: 'u1' },
  ],
  sales: [
    { id: 's1', reference: 'SALE-1', total_cents: 20000, payment_method: 'cash', paid_at: '2026-10-22T07:00:00Z', created_by: 'u1' },
    { id: 's2', reference: 'SALE-2', total_cents: 3000, payment_method: 'wallet', paid_at: '2026-10-22T07:30:00Z', created_by: 'u1' },
  ],
  movements: [
    { id: 'm1', type: 'cash_in', amount_cents: 1000, reason: 'Fond ajouté', created_by: 'u1', created_at: '2026-10-22T06:30:00Z' },
    { id: 'm2', type: 'cash_out', amount_cents: 500, reason: 'Dépôt', created_by: 'u1', created_at: '2026-10-22T09:30:00Z' },
  ],
  expenses: [
    { id: 'e1', amount_cents: 2000, description: 'Transport', category: 'Transport', status: 'approved', created_by: 'u1', created_at: '2026-10-22T08:30:00Z', approved_at: '2026-10-22T08:40:00Z' },
    { id: 'e2', amount_cents: 700, description: 'Eau', category: 'Autres', status: 'pending', created_by: 'u1', created_at: '2026-10-22T09:45:00Z' },
  ],
};

describe('CashBookService', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(NOW));
  afterEach(() => jest.restoreAllMocks());

  describe('day view', () => {
    it('adds cash receipts and payments to the opening and keeps non-cash apart', async () => {
      const { service } = setup({ ...DAY, closings: [{ id: 'c0', business_day: '2026-10-22', status: 'x' }].slice(1).concat([{ id: 'c1', business_day: '2026-10-21', status: 'closed', counted_cents: 50000 }] as any) });
      const v = await service.dayView('st1', '2026-10-22', 'CDF', 'u1', 'caissier', 'org1');
      expect(v.opening_cents).toBe(50000);
      expect(v.cash_sales_cents).toBe(30000); // ticket 10000 cash + sale 20000 cash
      expect(v.receipts_cents).toBe(31000); // + cash-in 1000
      expect(v.payments_cents).toBe(2500); // approved expense 2000 + cash-out 500 — the pending 700 is not an outflow yet
      expect(v.expected_cents).toBe(50000 + 31000 - 2500);
      expect(v.non_cash_cents).toBe(8000); // ScanLinkPay ticket + wallet sale
      expect(v.entries.map((e) => e.kind)).toEqual(['cash_in', 'sale', 'sale', 'expense', 'cash_out']);
      expect(v.entries[v.entries.length - 1].balance_cents).toBe(v.expected_cents);
      expect(v.pending_expenses_list).toEqual([expect.objectContaining({ id: 'e2', amount_cents: 700 })]);
      expect(v.pending_expenses).toBe(1);
      expect(v.can_close).toBe(true);
    });

    it('names the station cashiers and who closed the day, with tidy names, for the printed reports', async () => {
      const t = setup({ ...DAY, closings: [{ id: 'c1', business_day: '2026-10-22', status: 'closed', counted_cents: 1, closed_by: 'u1' }] }, (q) => {
        if (q.target === 'profiles') return { data: [{ id: 'u1', full_name: 'caissier  caissierTest', email: 'a@x.cd' }] };
        if (q.target === 'organization_staff') return { data: [{ user_id: 'u1' }] };
        if (q.target === 'user_roles') return { data: [{ user_id: 'u1', role: { slug: 'caissier' } }] };
        return undefined;
      });
      const v: any = await t.service.dayView('st1', '2026-10-22', 'CDF', 'u1', 'caissier', 'org1');
      expect(v.cashiers).toEqual(['caissier caissierTest']);
      expect(v.closing.closed_by_name).toBe('caissier caissierTest');
    });

    it('starts from zero before the first closing', async () => {
      const { service } = setup(DAY);
      const v = await service.dayView('st1', '2026-10-22', 'CDF', 'u1', 'caissier', 'org1');
      expect(v.opening_cents).toBe(0);
    });

    it('cannot be closed while a till session is open or an earlier day has activity', async () => {
      const open = setup({ ...DAY, openSession: true });
      expect((await open.service.dayView('st1', '2026-10-22', 'CDF', 'u1', 'caissier', 'org1')).blocked_by).toBe('open_session');

      const earlier = setup({
        closings: [{ id: 'c1', business_day: '2026-10-19', status: 'closed', counted_cents: 1000 }],
        sales: [{ id: 's0', reference: 'OLD', total_cents: 500, payment_method: 'cash', paid_at: '2026-10-20T10:00:00Z', created_by: 'u1' }],
      });
      expect((await earlier.service.dayView('st1', '2026-10-22', 'CDF', 'u1', 'caissier', 'org1')).blocked_by).toBe('earlier_day:2026-10-20');
    });

    it('ignores a till session left open in a shop that does not sell at a till', async () => {
      const t = setup({ ...DAY, openSession: true, sector: 'electronique' });
      const v = await t.service.dayView('st1', '2026-10-22', 'CDF', 'u1', 'caissier', 'org1');
      expect(v.blocked_by).toBeNull();
      expect(v.can_close).toBe(true);
    });

    it('a till session left open blocks the closing of supermarkets and food shops, not of other or unset sectors', async () => {
      for (const sector of ['supermarche', 'alimentation']) {
        const v = await setup({ ...DAY, openSession: true, sector }).service.dayView('st1', '2026-10-22', 'CDF', 'u1', 'caissier', 'org1');
        expect(v.blocked_by).toBe('open_session');
      }
      for (const sector of ['', 'electronique']) {
        const v = await setup({ ...DAY, openSession: true, sector }).service.dayView('st1', '2026-10-22', 'CDF', 'u1', 'caissier', 'org1');
        expect(v.blocked_by).toBeNull();
      }
    });

    it('rejects an unknown currency', async () => {
      await expect(setup().service.dayView('st1', '2026-10-22', 'EUR', 'u1', 'caissier', 'org1')).rejects.toThrow('Devise');
    });
  });

  describe('closing a day', () => {
    it('records the count, the expected cash and the discrepancy, then audits', async () => {
      const t = setup({ ...DAY, closings: [{ id: 'c1', business_day: '2026-10-21', status: 'closed', counted_cents: 50000 }] });
      const row: any = await t.service.closeDay('st1', { date: '2026-10-22', currency: 'CDF', counted_cents: 78000 }, 'u1', 'caissier', 'org1');
      expect(row.expected_cents).toBe(78500);
      expect(row.counted_cents).toBe(78000);
      expect(row.discrepancy_cents).toBe(-500);
      expect(row.opening_cents).toBe(50000);
      expect(row.status).toBe('closed');
      expect(t.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'cash_day_closed' }));
    });

    it('uses the declared opening only for the very first closing', async () => {
      const first = setup(DAY);
      const a: any = await first.service.closeDay('st1', { date: '2026-10-22', currency: 'CDF', counted_cents: 1000, opening_cents: 10000 }, 'u1', 'caissier', 'org1');
      expect(a.opening_cents).toBe(10000);
      const later = setup({ ...DAY, closings: [{ id: 'c1', business_day: '2026-10-21', status: 'closed', counted_cents: 50000 }] });
      const b: any = await later.service.closeDay('st1', { date: '2026-10-22', currency: 'CDF', counted_cents: 1000, opening_cents: 999999 }, 'u1', 'caissier', 'org1');
      expect(b.opening_cents).toBe(50000);
    });

    it('refuses a future day, a day already closed, an open till session and an earlier unclosed day', async () => {
      const base = { date: '2026-10-22', currency: 'CDF', counted_cents: 0 };
      await expect(setup().service.closeDay('st1', { ...base, date: '2026-10-23' }, 'u1', 'caissier', 'org1')).rejects.toThrow('pas encore arrivé');
      await expect(setup({ closings: [{ id: 'c', business_day: '2026-10-22', status: 'closed', counted_cents: 0 }] }).service.closeDay('st1', base, 'u1', 'caissier', 'org1')).rejects.toThrow('déjà clôturée');
      await expect(setup({ openSession: true }).service.closeDay('st1', base, 'u1', 'caissier', 'org1')).rejects.toThrow('session de caisse');
      const earlier = setup({
        closings: [{ id: 'c1', business_day: '2026-10-19', status: 'closed', counted_cents: 1000 }],
        sales: [{ id: 's0', reference: 'OLD', total_cents: 500, payment_method: 'cash', paid_at: '2026-10-20T10:00:00Z', created_by: 'u1' }],
      });
      await expect(earlier.service.closeDay('st1', base, 'u1', 'caissier', 'org1')).rejects.toThrow("Clôturez d'abord la journée du 2026-10-20");
    });

    it('rejects a negative or fractional count', async () => {
      await expect(setup().service.closeDay('st1', { date: '2026-10-22', currency: 'CDF', counted_cents: -1 }, 'u1', 'caissier', 'org1')).rejects.toThrow('invalide');
      await expect(setup().service.closeDay('st1', { date: '2026-10-22', currency: 'CDF', counted_cents: 10.5 }, 'u1', 'caissier', 'org1')).rejects.toThrow('invalide');
    });
  });

  describe('reopening', () => {
    const closed = { id: 'c1', merchant_id: 'st1', business_day: '2026-10-21', currency: 'CDF', status: 'closed', counted_cents: 1000, closed_by: 'u1' };

    it('is for the manager or the owner only, with a reason', async () => {
      const t = setup({ closings: [closed] });
      await expect(t.service.reopenDay('st1', 'c1', 'Erreur de comptage', 'u2', 'caissier', 'org1')).rejects.toThrow('gérant ou le patron');
      await expect(t.service.reopenDay('st1', 'c1', 'x', 'u2', 'gerant', 'org1')).rejects.toThrow('motif');
      const ok = await t.service.reopenDay('st1', 'c1', 'Erreur de comptage', 'u2', 'gerant', 'org1');
      expect((ok as any).status).toBe('reopened');
      expect(t.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'cash_day_reopened' }));
    });

    it('only the most recent closed day can be reopened', async () => {
      const newer = { ...closed, id: 'c2', business_day: '2026-10-22' };
      const t = setup({ closings: [closed, newer] }, (q) => {
        if (q.target === 'cash_day_closings' && q.calls.some((c) => c.method === 'maybeSingle') && q.calls.some((c) => c.method === 'eq' && c.args[0] === 'id')) return { data: closed };
        return undefined;
      });
      await expect(t.service.reopenDay('st1', 'c1', 'Erreur de comptage', 'boss', 'enterprise', 'org1')).rejects.toThrow('plus récente');
    });
  });

  describe('station expenses', () => {
    const dto = { amount_cents: 2000, currency: 'CDF', category: 'Transport', description: 'Course moto' };

    it('a seller records a pending expense and the managers are told', async () => {
      const t = setup();
      const row: any = await t.service.createExpense('st1', dto, 'u1', 'vendeur', 'org1');
      expect(row.status).toBe('pending');
      expect(t.notifications.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'station_expense_pending' }));
    });

    it('a manager or the owner records an approved expense', async () => {
      const row: any = await setup().service.createExpense('st1', dto, 'boss', 'enterprise', 'org1');
      expect(row.status).toBe('approved');
      expect(row.approved_by).toBe('boss');
    });

    it('an expense is an outflow on the day it is approved, not the day it was written', async () => {
      const t = setup({ expenses: [{ id: 'old', amount_cents: 900, description: 'Taxi', category: 'Transport', status: 'approved', created_by: 'u1', created_at: '2026-10-21T15:00:00Z', approved_at: '2026-10-22T09:00:00Z' }] });
      const today: any = await t.service.dayView('st1', '2026-10-22', 'CDF', 'u1', 'caissier', 'org1');
      expect(today.expenses_cents).toBe(900);
      const yesterday: any = await t.service.dayView('st1', '2026-10-21', 'CDF', 'u1', 'caissier', 'org1');
      expect(yesterday.expenses_cents).toBe(0);
    });

    it('an approved expense without approved_at (older ones) falls on its creation day', async () => {
      const t = setup({ expenses: [{ id: 'legacy', amount_cents: 400, description: 'Eau', status: 'approved', created_by: 'u1', created_at: '2026-10-22T08:00:00Z' }] });
      expect(((await t.service.dayView('st1', '2026-10-22', 'CDF', 'u1', 'caissier', 'org1')) as any).expenses_cents).toBe(400);
    });

    it('approving tells the seller it is now an outflow; rejecting says nothing is deducted; a closed day today refuses the approval', async () => {
      const pending = { id: 'e1', merchant_id: 'st1', status: 'pending', amount_cents: 2000, currency: 'CDF', description: 'Transport', created_by: 'u1', created_at: '2026-10-21T08:30:00Z' };
      const responder = (q: any) => (q.target === 'organization_expenses' && q.calls.some((c: any) => c.method === 'maybeSingle') && !q.calls.some((c: any) => c.method === 'update') ? { data: pending } : undefined);
      const ok = setup({}, responder);
      await ok.service.reviewExpense('st1', 'e1', 'approve', undefined, 'boss', 'enterprise', 'org1');
      expect(ok.notifications.create).toHaveBeenCalledWith(expect.objectContaining({
        user_id: 'u1', type: 'station_expense_approved', title: 'Dépense validée — sortie de caisse', body: expect.stringContaining('déduits de la caisse'),
      }));
      const ko = setup({}, responder);
      await ko.service.reviewExpense('st1', 'e1', 'reject', 'Pas justifiée', 'boss', 'enterprise', 'org1');
      expect(ko.notifications.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'station_expense_rejected', body: expect.stringContaining('Rien n') }));
      const closed = setup({ closings: [{ id: 'c', business_day: '2026-10-22', status: 'closed', counted_cents: 0 }] }, responder);
      await expect(closed.service.reviewExpense('st1', 'e1', 'approve', undefined, 'boss', 'enterprise', 'org1')).rejects.toThrow('clôturée');
    });

    it('needs a category, a reason and a positive amount, and is refused on a closed day', async () => {
      const t = setup();
      await expect(t.service.createExpense('st1', { ...dto, category: ' ' }, 'u1', 'vendeur', 'org1')).rejects.toThrow('catégorie');
      await expect(t.service.createExpense('st1', { ...dto, description: 'a' }, 'u1', 'vendeur', 'org1')).rejects.toThrow('motif');
      await expect(t.service.createExpense('st1', { ...dto, amount_cents: 0 }, 'u1', 'vendeur', 'org1')).rejects.toThrow('Montant');
      const closed = setup({ closings: [{ id: 'c', business_day: '2026-10-22', status: 'closed', counted_cents: 0 }] });
      await expect(closed.service.createExpense('st1', dto, 'u1', 'vendeur', 'org1')).rejects.toThrow('clôturée');
    });

    it('only a manager approves or rejects, a rejection needs a reason', async () => {
      const pending = { id: 'e1', merchant_id: 'st1', status: 'pending', amount_cents: 2000, currency: 'CDF', description: 'Transport', created_by: 'u1', created_at: '2026-10-22T08:30:00Z' };
      const t = setup({}, (q) => (q.target === 'organization_expenses' && q.calls.some((c) => c.method === 'maybeSingle') && !q.calls.some((c) => c.method === 'update') ? { data: pending } : undefined));
      await expect(t.service.reviewExpense('st1', 'e1', 'approve', undefined, 'u2', 'caissier', 'org1')).rejects.toThrow('gérant ou le patron');
      await expect(t.service.reviewExpense('st1', 'e1', 'reject', ' ', 'u2', 'gerant', 'org1')).rejects.toThrow('motif');
    });
  });

  describe('archive (binders)', () => {
    it('lists one binder per year from the oldest activity to the current year, with the closed days totals', async () => {
      const t = setup({
        sales: [{ id: 'old', paid_at: '2024-03-05T10:00:00Z' }],
        closings: [
          { id: 'a', business_day: '2025-12-30', status: 'closed', cash_sales_cents: 1000, cash_in_cents: 0, expenses_cents: 200, cash_out_cents: 0, discrepancy_cents: -50 },
          { id: 'b', business_day: '2026-10-21', status: 'closed', cash_sales_cents: 5000, cash_in_cents: 500, expenses_cents: 300, cash_out_cents: 100, discrepancy_cents: 0 },
        ],
      });
      const a: any = await t.service.archive('st1', 'CDF', 'u1', 'caissier', 'org1');
      expect(a.first_day).toBe('2024-03-05');
      expect(a.years.map((y: any) => y.year)).toEqual([2026, 2025, 2024]);
      expect(a.years[0]).toMatchObject({ closed_days: 1, receipts_cents: 5500, payments_cents: 400, discrepancy_cents: 0 });
      expect(a.years[1]).toMatchObject({ closed_days: 1, receipts_cents: 1000, payments_cents: 200, discrepancy_cents: -50 });
      expect(a.years[2]).toMatchObject({ closed_days: 0, receipts_cents: 0 });
    });

    it('a station without any activity only has the current year', async () => {
      const a: any = await setup().service.archive('st1', 'USD', 'u1', 'caissier', 'org1');
      expect(a.first_day).toBeNull();
      expect(a.years.map((y: any) => y.year)).toEqual([2026]);
    });
  });

  describe('monthly book', () => {
    it('chains the days: opening, running balance, adjustment for the count gap, closing', async () => {
      const t = setup({
        sales: [
          { id: 'a', reference: 'S-A', total_cents: 10000, payment_method: 'cash', paid_at: '2026-10-05T08:00:00Z', created_by: 'u1' },
          { id: 'b', reference: 'S-B', total_cents: 4000, payment_method: 'cash', paid_at: '2026-10-06T08:00:00Z', created_by: 'u1' },
        ],
        expenses: [{ id: 'x', amount_cents: 1000, description: 'Eau', category: 'Autres', status: 'approved', created_by: 'u1', created_at: '2026-10-06T09:00:00Z' }],
        closings: [
          { id: 'cl1', business_day: '2026-09-30', status: 'closed', counted_cents: 2000 },
          { id: 'cl2', business_day: '2026-10-05', status: 'closed', counted_cents: 11500, closed_at: '2026-10-05T20:00:00Z', closed_by: 'u1' }, // expected 12000 → gap −500
        ],
      });
      const book: any = await t.service.monthBook('st1', '2026-10', 'CDF', 'u1', 'caissier', 'org1');
      expect(book.opening_cents).toBe(2000);
      const d5 = book.days.find((d: any) => d.day === '2026-10-05');
      expect(d5.expected_cents).toBe(12000);
      expect(d5.closing_cents).toBe(11500);
      expect(d5.discrepancy_cents).toBe(-500);
      expect(d5.entries[d5.entries.length - 1]).toEqual(expect.objectContaining({ kind: 'adjustment', direction: 'out', amount_cents: 500 }));
      const d6 = book.days.find((d: any) => d.day === '2026-10-06');
      expect(d6.opening_cents).toBe(11500); // the counted cash of the day before
      expect(d6.closing_cents).toBe(11500 + 4000 - 1000);
      expect(book.closing_cents).toBe(14500);
      expect(book.receipts_cents).toBe(14000);
      expect(book.payments_cents).toBe(1000);
      expect(book.unclosed_days).toEqual(['2026-10-06']);
    });

    it('rejects a bad month', async () => {
      await expect(setup().service.monthBook('st1', '2026-1', 'CDF', 'u1', 'caissier', 'org1')).rejects.toThrow('Mois invalide');
    });
  });

  describe('report', () => {
    it('totals a week by day, by method, by expense category and flags unclosed days', async () => {
      const t = setup({
        tickets: DAY.tickets,
        payments: [],
        sales: DAY.sales,
        movements: DAY.movements,
        expenses: DAY.expenses,
      });
      const r: any = await t.service.report('st1', 'week', '2026-10-22', 'CDF', 'u1', 'caissier', 'org1');
      expect(r.first_day).toBe('2026-10-19');
      expect(r.last_day).toBe('2026-10-25');
      expect(r.series).toHaveLength(7);
      expect(r.cash_sales_cents).toBe(30000);
      expect(r.non_cash_cents).toBe(8000);
      expect(r.turnover_cents).toBe(38000);
      expect(r.payments_cents).toBe(2500);
      expect(r.sales_count).toBe(4);
      expect(r.by_category).toEqual([{ category: 'Transport', amount_cents: 2000 }]);
      expect(r.by_method).toEqual(expect.arrayContaining([{ method: 'Espèces', amount_cents: 30000 }, { method: 'ScanLinkPay', amount_cents: 8000 }]));
      expect(r.unclosed_days).toEqual([]); // 22 October is today
    });

    it('year reports are grouped by month', async () => {
      const r: any = await setup(DAY).service.report('st1', 'year', '2026-10-22', 'CDF', 'u1', 'caissier', 'org1');
      expect(r.series).toHaveLength(12);
      expect(r.series.find((s: any) => s.key === '2026-10').cash_sales_cents).toBe(30000);
    });

    it('rejects an unknown period', async () => {
      await expect(setup().service.report('st1', 'decade', undefined, 'CDF', 'u1', 'caissier', 'org1')).rejects.toThrow('Période');
    });
  });
});
