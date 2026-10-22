import { StockService } from './stock.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

function setup(opts: { existing?: any; insert?: { data?: any; error?: any }[] }) {
  const inserts = [...(opts.insert ?? [{ data: { id: 'mv-new' } }])];
  let lookups = 0;
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'stock_items') return { data: { quantity: 10, name: 'Savon', low_stock_threshold: 2 } };
    if (q.target === 'stock_movements') {
      if (q.calls.some((c) => c.method === 'insert')) return inserts.shift() ?? { data: { id: 'mv-new' } };
      lookups += 1;
      return { data: lookups === 1 ? opts.existing ?? null : { id: 'mv-first' } };
    }
    return { data: null };
  });
  const service: any = Object.create(StockService.prototype);
  service.supabaseService = fake.service;
  service.logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };
  jest.spyOn(service, 'resolveMerchantAccess').mockResolvedValue({ id: 'm1', organization_id: null });
  const inserted = () => fake.queries.filter((q) => q.target === 'stock_movements' && q.calls.some((c) => c.method === 'insert'));
  return { service, inserted };
}

const ref = '9b2f6a1e-1c4d-4b8e-9f00-2a7c3d4e5f60';

describe('Stock movements made offline', () => {
  it('already received (same client_ref): the first one comes back, nothing is applied twice', async () => {
    const { service, inserted } = setup({ existing: { id: 'mv-first' } });
    const r = await service.createMovement('m1', 'i1', 'u1', 'magasinier', 'o1', { type: 'in', quantity_delta: 10, client_ref: ref });
    expect(r).toEqual({ id: 'mv-first' });
    expect(inserted()).toHaveLength(0);
  });

  it('a new one is recorded with its client_ref', async () => {
    const { service, inserted } = setup({});
    await service.createMovement('m1', 'i1', 'u1', 'magasinier', 'o1', { type: 'in', quantity_delta: 10, client_ref: ref });
    expect(inserted()[0].calls.find((c) => c.method === 'insert')!.args[0]).toMatchObject({ client_ref: ref, quantity_delta: 10 });
  });

  it('two sends that cross: the unique index keeps one, it is returned', async () => {
    const { service } = setup({ insert: [{ error: { code: '23505', message: 'duplicate key' } }] });
    const r = await service.createMovement('m1', 'i1', 'u1', 'magasinier', 'o1', { type: 'in', quantity_delta: 10, client_ref: ref });
    expect(r).toEqual({ id: 'mv-first' });
  });
});
