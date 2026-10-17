import { ReportsCronService, kinshasaDay } from './reports-cron.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

const report = (station: { id: string; name: string }, currency: 'CDF' | 'USD', revenue: number, tickets: number, gap = 0, outs = 0) => ({
  station, currency, from: '', to: '',
  totals: { tickets, revenue_cents: revenue, avg_basket_cents: 0, by_method: {} },
  sessions: tickets ? [{}] : [],
  sessions_total: { count: 1, open: 0, discrepancy_cents: gap, with_discrepancy: gap ? 1 : 0 },
  stock_alerts: Array.from({ length: outs }, (_, i) => ({ id: `i${i}`, name: 'X', quantity: 0, threshold: 5 })),
  daily: [], by_cashier: [], voids: [], voids_total: { count: 0, amount_cents: 0 }, top_products: [],
});

function setup() {
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'organizations') return { data: [{ id: 'org1', name: 'ABC', owner_id: 'boss' }] };
    if (q.target === 'merchants') return { data: [{ id: 'goma', name: 'Goma' }, { id: 'beni', name: 'Beni' }] };
    if (q.target === 'organization_staff') {
      const station = q.calls.find((c) => c.method === 'eq' && c.args[0] === 'merchant_id')?.args[1];
      return { data: station === 'goma' ? [{ user_id: 'mgr-goma' }] : [] };
    }
    if (q.target === 'user_roles') return { data: [{ user_id: 'mgr-goma', role: { slug: 'gerant' } }] };
    return { data: null };
  });
  const reports = {
    buildStationReport: jest.fn(async (station: any, period: any) =>
      station.id === 'goma'
        ? report(station, period.currency, period.currency === 'CDF' ? 12000000 : 0, period.currency === 'CDF' ? 14 : 0, period.currency === 'CDF' ? -200000 : 0, period.currency === 'CDF' ? 2 : 0)
        : report(station, period.currency, 0, 0)),
  };
  const notifications = { create: jest.fn(async () => undefined) };
  const service = new ReportsCronService(fake.service, reports as any, notifications as any);
  return { service, notifications };
}

describe('the evening report', () => {
  it('Kinshasa day: 21:00 local is still the same day, as [00:00, 24:00) in UTC+1', () => {
    expect(kinshasaDay(new Date('2026-10-16T20:00:00Z'))).toEqual({ day: '2026-10-16', from: '2026-10-15T23:00:00.000Z', to: '2026-10-16T23:00:00.000Z' });
  });

  it('the owner gets one summary of the active stations, the station manager their own — idle stations left out', async () => {
    const { service, notifications } = setup();
    await service.sendDailyReports(new Date('2026-10-16T20:00:00Z'));
    const sent = notifications.create.mock.calls.map((c: any[]) => c[0]);
    expect(sent.map((n: any) => n.user_id).sort()).toEqual(['boss', 'mgr-goma']);

    const owner = sent.find((n: any) => n.user_id === 'boss');
    expect(owner.title).toBe('Rapport du jour — ABC');
    expect(owner.body).toContain('Goma');
    expect(owner.body).not.toContain('Beni');
    expect(owner.body).toMatch(/écart/);
    expect(owner.body).toContain('2 produit(s) en rupture');
    expect(owner.data.url).toBe('/dashboard/organization/reports?date=2026-10-16');

    const manager = sent.find((n: any) => n.user_id === 'mgr-goma');
    expect(manager.data.url).toBe('/dashboard/organization/reports?date=2026-10-16&station=goma');
  });
});
