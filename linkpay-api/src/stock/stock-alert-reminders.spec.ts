import { StockService } from './stock.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

const selectOf = (q: RecordedQuery) => String(q.calls.find((c) => c.method === 'select')?.args[0] ?? '');
const merchant = { id: 'm1', name: 'Station Goma', organization_id: 'org1' };

/** One article per entry; `mutes` are the rows of stock_alert_mutes. */
function build(items: { id: string; name: string; quantity: number; low_stock_threshold: number }[], mutes: { user_id: string; stock_item_id: string | null }[] = []) {
  const fake = createFakeSupabase((q) => {
    if (q.target === 'stock_items' && selectOf(q).includes('merchants!inner')) return { data: items.map((i) => ({ ...i, merchants: merchant })) };
    if (q.target === 'stock_alert_mutes') return { data: mutes };
    if (q.target === 'organization_staff') return { data: [{ user_id: 'cashier' }, { user_id: 'keeper' }] };
    if (q.target === 'user_roles') return { data: [{ user_id: 'cashier', role: { slug: 'caissier' } }, { user_id: 'keeper', role: { slug: 'magasinier' } }] };
    return { data: null };
  });
  const notifications = { create: jest.fn(async () => undefined) };
  const orgs = { getOrganizationById: jest.fn(async () => ({ id: 'org1', owner_id: 'boss' })) };
  const service = new StockService(fake.service, orgs as any, notifications as any, {} as any, { log: jest.fn() } as any, {} as any);
  return { service, notifications, fake };
}

const recipients = (create: jest.Mock) => create.mock.calls.map((c: any[]) => c[0].user_id).sort();

describe('stock alert — repeated every 24 h until refilled or muted', () => {
  it('announces again an article still below its threshold, naming it for the voice', async () => {
    const { service, notifications } = build([{ id: 'i1', name: 'Coca 33 cl', quantity: 2, low_stock_threshold: 5 }]);
    expect(await service.sendLowStockReminders()).toBe(1);
    expect(recipients(notifications.create)).toEqual(['boss', 'cashier', 'keeper']);
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'stock_low', data: expect.objectContaining({ item_name: 'Coca 33 cl', out: false, reminder: true }) }),
    );
  });

  it('says "Rupture de stock" for an article that ran out', async () => {
    const { service, notifications } = build([{ id: 'i1', name: 'Riz 5 kg', quantity: 0, low_stock_threshold: 5 }]);
    await service.sendLowStockReminders();
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Rupture de stock', data: expect.objectContaining({ out: true }) }));
  });

  it('stops by itself once the article is refilled above its threshold', async () => {
    const { service, notifications } = build([{ id: 'i1', name: 'Coca 33 cl', quantity: 40, low_stock_threshold: 5 }]);
    expect(await service.sendLowStockReminders()).toBe(0);
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('leaves out whoever muted this article, and whoever muted every stock alert', async () => {
    const { service, notifications } = build(
      [{ id: 'i1', name: 'Coca 33 cl', quantity: 2, low_stock_threshold: 5 }],
      [{ user_id: 'cashier', stock_item_id: 'i1' }, { user_id: 'boss', stock_item_id: null }],
    );
    await service.sendLowStockReminders();
    expect(recipients(notifications.create)).toEqual(['keeper']);
  });

  it('only asks for articles not announced for 24 h (never more often)', async () => {
    const now = new Date('2026-10-27T10:00:00Z');
    const { service, fake } = build([]);
    await service.sendLowStockReminders(now);
    const q = fake.queries.find((x) => x.target === 'stock_items')!;
    const filter = String(q.calls.find((c) => c.method === 'or')?.args[0]);
    expect(filter).toContain('low_alert_sent_at.is.null');
    expect(filter).toContain('low_alert_sent_at.lt.2026-10-26T10:00:00.000Z');
  });
});

describe('muting stock alerts', () => {
  it('reads what the user muted', async () => {
    const fake = createFakeSupabase((q) => (q.target === 'stock_alert_mutes' ? { data: [{ stock_item_id: null }, { stock_item_id: 'i1' }] } : undefined));
    const service = new StockService(fake.service, {} as any, {} as any, {} as any, {} as any, {} as any);
    expect(await service.listAlertMutes('u1')).toEqual({ all: true, item_ids: ['i1'] });
  });

  it('muting twice is not an error', async () => {
    const fake = createFakeSupabase((q) =>
      q.target === 'stock_alert_mutes' && q.calls.some((c) => c.method === 'insert') ? { error: { code: '23505', message: 'duplicate' } } : { data: [] },
    );
    const service = new StockService(fake.service, {} as any, {} as any, {} as any, {} as any, {} as any);
    await expect(service.muteAlerts('u1', 'i1')).resolves.toEqual({ all: false, item_ids: [] });
  });
});
