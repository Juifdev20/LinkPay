import { ForbiddenException } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { StockService } from '../stock/stock.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

const PERIOD = { from: '2026-10-16T00:00:00.000Z', to: '2026-10-17T00:00:00.000Z', currency: 'CDF' as const };

function setup(opts: { callerStation?: string } = {}) {
  const fake = createFakeSupabase((q: RecordedQuery) => {
    const sel = String(q.calls.find((c) => c.method === 'select')?.args[0] ?? '');
    switch (q.target) {
      case 'merchants':
        return { data: { id: 'm1', name: 'Station Goma', owner_id: 'boss', organization_id: 'org1' } };
      case 'organization_staff':
        return { data: { merchant_id: opts.callerStation ?? 'm1', deactivated_at: null } };
      case 'pos_tickets':
        return { data: [
          { id: 't1', total_cents: 10000, paid_at: '2026-10-16T09:00:00Z', cashier_user_id: 'alice', payment_method: 'cash' },
          { id: 't2', total_cents: 5000, paid_at: '2026-10-16T10:00:00Z', cashier_user_id: 'bob', payment_method: 'mixed' },
          { id: 't3', total_cents: 4000, paid_at: '2026-10-16T11:00:00Z', cashier_user_id: 'alice', payment_method: 'scanlinkpay' },
        ] };
      case 'pos_ticket_payments':
        return { data: [
          { ticket_id: 't1', method: 'cash', amount_cents: 10000 },
          { ticket_id: 't2', method: 'cash', amount_cents: 3000 },
          { ticket_id: 't2', method: 'scanlinkpay', amount_cents: 2000 },
          // t3 predates payment rows: its method takes the whole total
        ] };
      case 'pos_ticket_items':
        if (sel.includes('voided_by')) {
          return { data: [{ product_name_snapshot: 'Riz', quantity: 1, line_total_cents: 2500, voided_by: 'alice', voided_reason: 'Erreur de scan', voided_at: '2026-10-16T09:30:00Z', ticket: { ticket_number: 12 } }] };
        }
        return { data: [
          { ticket_id: 't1', stock_item_id: 'i1', product_name_snapshot: 'Riz', quantity: 2, line_total_cents: 10000 },
          { ticket_id: 't2', stock_item_id: 'i2', product_name_snapshot: 'Huile', quantity: 1, line_total_cents: 5000 },
        ] };
      case 'cash_register_sessions':
        return { data: [
          { id: 's1', cashier_user_id: 'alice', status: 'closed', opening_float_cents: 1000, expected_cents: 14000, closing_counted_cents: 13500, discrepancy_cents: -500 },
          { id: 's2', cashier_user_id: 'bob', status: 'open', opening_float_cents: 1000, expected_cents: null, closing_counted_cents: null, discrepancy_cents: null },
        ] };
      case 'stock_items':
        return { data: [{ id: 'i1', name: 'Riz', quantity: 2, low_stock_threshold: 5 }, { id: 'i2', name: 'Huile', quantity: 30, low_stock_threshold: 5 }] };
      case 'profiles':
        return { data: [{ id: 'alice', full_name: 'Alice K.' }, { id: 'bob', full_name: 'Bob M.' }] };
      default:
        return { data: null };
    }
  });
  const stock = new StockService(fake.service, {} as any, {} as any, {} as any, {} as any, {} as any);
  const orgs = { getOrganizationById: jest.fn(async () => ({ id: 'org1', owner_id: 'boss' })), getOrganizationMerchants: jest.fn(async () => [{ id: 'm1', name: 'Station Goma' }]) };
  return new ReportsService(fake.service, stock, orgs as any);
}

describe("a station's report", () => {
  it('adds up sales by payment method — a mixed ticket split, an old ticket by its own method', async () => {
    const r = await setup().stationReport('m1', 'boss', 'enterprise', undefined, PERIOD);
    expect(r.totals).toMatchObject({ tickets: 3, revenue_cents: 19000, by_method: { cash: 13000, scanlinkpay: 6000 } });
  });

  it('shows each cashier: sales, cash, voids and their till discrepancy', async () => {
    const r = await setup().stationReport('m1', 'boss', 'enterprise', undefined, PERIOD);
    const alice = r.by_cashier.find((c) => c.user_id === 'alice')!;
    expect(alice).toMatchObject({ name: 'Alice K.', tickets: 2, revenue_cents: 14000, cash_cents: 10000, voids: 1, discrepancy_cents: -500 });
    expect(r.sessions_total).toMatchObject({ count: 2, open: 1, discrepancy_cents: -500, with_discrepancy: 1 });
  });

  it('lists the voided lines with who and why, the best products and the stock to watch', async () => {
    const r = await setup().stationReport('m1', 'boss', 'enterprise', undefined, PERIOD);
    expect(r.voids[0]).toMatchObject({ product: 'Riz', by: 'Alice K.', reason: 'Erreur de scan', ticket_number: 12 });
    expect(r.top_products[0]).toMatchObject({ name: 'Riz', quantity: 2 });
    expect(r.stock_alerts.map((i) => i.name)).toEqual(['Riz']);
  });

  it('the station manager reads their own station — not another one', async () => {
    await expect(setup({ callerStation: 'm1' }).stationReport('m1', 'mgr', 'gerant', 'org1', PERIOD)).resolves.toBeDefined();
    await expect(setup({ callerStation: 'm2' }).stationReport('m1', 'mgr', 'gerant', 'org1', PERIOD)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a cashier does not get the station report', async () => {
    await expect(setup().stationReport('m1', 'cash1', 'caissier', 'org1', PERIOD)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('all stations side by side is for the owner only', async () => {
    const service = setup();
    await expect(service.organizationReport('org1', 'boss', PERIOD)).resolves.toMatchObject({ totals: { revenue_cents: 19000, tickets: 3 } });
    await expect(service.organizationReport('org1', 'mgr', PERIOD)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
