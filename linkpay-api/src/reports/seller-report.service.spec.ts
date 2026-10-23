import { ForbiddenException } from '@nestjs/common';
import { SellerReportService } from './seller-report.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

function setup(opts: { staffStation?: string } = {}) {
  const fake = createFakeSupabase((q: RecordedQuery) => {
    switch (q.target) {
      case 'pos_tickets':
        return { data: [
          { id: 't1', cashier_user_id: 'ana', total_cents: 1000, currency: 'CDF' },
          { id: 't2', cashier_user_id: 'ana', total_cents: 500, currency: 'USD' },
        ] };
      case 'pos_ticket_items':
        return { data: [
          { ticket_id: 't1', quantity: 2, line_total_cents: 1000, cost_price_cents_snapshot: 300 },
          { ticket_id: 't2', quantity: 1, line_total_cents: 500, cost_price_cents_snapshot: null },
        ] };
      case 'sales':
        return { data: [
          { id: 's1', created_by: 'ben', total_cents: 20000, currency: 'USD', sale_items: [
            { quantity: 1, unit_price_cents: 15000, unit_cost_cents: 10000 },
            { quantity: 1, unit_price_cents: 5000, unit_cost_cents: 0 },
          ] },
          { id: 's2', created_by: 'ana', total_cents: 700, currency: 'CDF', sale_items: [{ quantity: 1, unit_price_cents: 700, unit_cost_cents: 200 }] },
        ] };
      case 'profiles':
        return { data: [{ id: 'ana', full_name: 'Ana' }, { id: 'ben', full_name: 'Ben' }] };
      case 'organization_staff':
        return { data: { merchant_id: opts.staffStation ?? 'm1', deactivated_at: null } };
      default:
        return { data: null };
    }
  });
  const orgs = {
    getOrganizationById: jest.fn(async () => ({ id: 'org1', owner_id: 'boss' })),
    getOrganizationMerchants: jest.fn(async () => [{ id: 'm1', name: 'Goma' }, { id: 'm2', name: 'Bukavu' }]),
  };
  return { service: new SellerReportService(fake.service, orgs as any), fake };
}

const period = { from: '2026-10-01T00:00:00.000Z', to: '2026-10-23T00:00:00.000Z' };

describe('seller report (till + Ventes, all sectors)', () => {
  it('adds up the till tickets and the Ventes per seller, per currency, with the margin on known purchase prices only', async () => {
    const res = await setup().service.report('org1', { id: 'boss', role: 'enterprise' }, period);
    const ana = res.sellers.find((s) => s.user_id === 'ana')!;
    expect(ana).toEqual(expect.objectContaining({ name: 'Ana', sales_count: 3, till_tickets: 2, module_sales: 1, units: 4 }));
    expect(ana.revenue).toEqual({ CDF: 1700, USD: 500 });
    expect(ana.margin).toEqual({ CDF: 1000 - 600 + 500 }); // the USD till line had no purchase price
    const ben = res.sellers.find((s) => s.user_id === 'ben')!;
    expect(ben.margin).toEqual({ USD: 5000 }); // the 0-cost line is "unknown", not 100 % margin
    expect(ben.revenue_with_cost).toEqual({ USD: 15000 });
    expect(res.totals.revenue).toEqual({ CDF: 1700, USD: 20500 });
  });

  it("a manager sees their station only; a seller or another company's staff, nothing", async () => {
    const { service, fake } = setup({ staffStation: 'm2' });
    await service.report('org1', { id: 'g', role: 'gerant', organization_id: 'org1' }, period);
    const tickets = fake.queries.find((q) => q.target === 'pos_tickets')!;
    expect(tickets.calls.find((c) => c.method === 'in')!.args[1]).toEqual(['m2']);
    await expect(setup().service.report('org1', { id: 'v', role: 'vendeur', organization_id: 'org1' }, period)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(setup().service.report('org1', { id: 'g', role: 'gerant', organization_id: 'org2' }, period)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
