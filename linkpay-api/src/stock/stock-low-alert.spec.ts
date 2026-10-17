import { StockService } from './stock.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

/** A sale that takes an article from `before` to `after` units (threshold 5), in station m1 of org1. */
function sell(before: number, after: number) {
  const selectOf = (q: RecordedQuery) => String(q.calls.find((c) => c.method === 'select')?.args[0] ?? '');
  const fake = createFakeSupabase((q) => {
    if (q.target === 'merchants') return { data: { id: 'm1', name: 'Station Goma', owner_id: 'boss', organization_id: 'org1' } };
    if (q.target === 'stock_items' && selectOf(q) === 'quantity') return { data: { quantity: before } };
    if (q.target === 'stock_items') return { data: { name: 'Riz 5 kg', quantity: after, low_stock_threshold: 5 } };
    if (q.target === 'stock_movements') return { data: { id: 'mv1' } };
    if (q.target === 'organization_staff') {
      // the seller's own station check, then the station's staff list
      return selectOf(q).includes('merchant_id, deactivated_at')
        ? { data: { merchant_id: 'm1', deactivated_at: null } }
        : { data: [{ user_id: 'cashier' }, { user_id: 'keeper' }, { user_id: 'accountant' }] };
    }
    if (q.target === 'user_roles') {
      return { data: [
        { user_id: 'cashier', role: { slug: 'caissier' } },
        { user_id: 'keeper', role: { slug: 'magasinier' } },
        { user_id: 'accountant', role: { slug: 'comptable' } },
      ] };
    }
    return { data: null };
  });
  const notifications = { create: jest.fn(async () => undefined) };
  const orgs = { getOrganizationById: jest.fn(async () => ({ id: 'org1', owner_id: 'boss' })) };
  const service = new StockService(fake.service, orgs as any, notifications as any, {} as any, { log: jest.fn() } as any);
  const run = () => service.createMovement('m1', 'item1', 'cashier', 'caissier', 'org1', { type: 'sale', quantity_delta: after - before });
  return { run, notifications };
}

const recipients = (create: jest.Mock) => create.mock.calls.map((c: any[]) => c[0].user_id).sort();

describe('low stock alert — the owner and the people on the floor', () => {
  it('crossing the threshold tells the owner, the cashier and the stock keeper — not the accountant', async () => {
    const { run, notifications } = sell(6, 5);
    await run();
    expect(recipients(notifications.create)).toEqual(['boss', 'cashier', 'keeper']);
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Stock bas' }));
  });

  it('is not repeated on every sale below the threshold', async () => {
    const { run, notifications } = sell(4, 3);
    await run();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('running out is announced once more, as a stock-out', async () => {
    const { run, notifications } = sell(1, 0);
    await run();
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Rupture de stock' }));
  });
});
