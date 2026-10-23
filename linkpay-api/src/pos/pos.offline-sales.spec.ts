import { BadRequestException } from '@nestjs/common';
import { PosService } from './pos.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

function setup(rpc: { data?: any; error?: { message: string } }) {
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'rpc:record_offline_pos_sale') return rpc;
    if (q.target === 'pos_tickets') return { data: { id: 't9', merchant_id: 'm1', total_cents: 1270000, status: 'paid' } };
    return { data: [] };
  });
  const service: any = Object.create(PosService.prototype);
  service.supabaseService = fake.service;
  Object.defineProperty(service, 'db', { get: () => fake.service.getClient() });
  service.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  service.auditService = { log: jest.fn(async () => undefined) };
  const access = jest.spyOn(service, 'assertAccess').mockResolvedValue({ id: 'm1' });
  jest.spyOn(service, 'withDetails').mockImplementation(async (t: any) => ({ ...t, items: [], payments: [] }));
  return { service, fake, access };
}

const sale = {
  client_ref: '9b2f6a1e-1c4d-4b8e-9f00-2a7c3d4e5f60',
  currency: 'CDF',
  sold_at: '2026-10-22T08:00:00.000Z',
  items: [
    { stock_item_id: 'a', quantity: 1, unit_price_cents: 90000 },
    { stock_item_id: 'b', quantity: 2, unit_price_cents: 500000 },
    { stock_item_id: 'a', quantity: 2, unit_price_cents: 90000 },
  ],
  received_cents: 2000000,
};

describe('Till — sales made offline', () => {
  it('checks access, merges the taps of the same product and records everything through one SQL call', async () => {
    const { service, fake, access } = setup({ data: { ticket_id: 't9', created: true, conflicts: [] } });
    const r = await service.recordOfflineSale('m1', 'u1', 'caissier', 'o1', sale);
    expect(access).toHaveBeenCalledWith('m1', 'u1', 'caissier', 'o1');
    const call = fake.queries.find((q) => q.target === 'rpc:record_offline_pos_sale')!.calls[0].args[0];
    expect(call).toMatchObject({ p_merchant_id: 'm1', p_cashier_id: 'u1', p_client_ref: sale.client_ref, p_currency: 'CDF', p_received_cents: 2000000 });
    expect(call.p_items).toEqual([
      { stock_item_id: 'a', quantity: 3, unit_price_cents: 90000 },
      { stock_item_id: 'b', quantity: 2, unit_price_cents: 500000 },
    ]);
    expect(r).toMatchObject({ id: 't9', created: true, conflicts: [] });
    expect(service.auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'offline_sale_recorded', entity_id: 't9' }));
  });

  it('what the till could not know comes back as conflicts and goes to the journal', async () => {
    const conflicts = [{ type: 'stock_short', name: 'Riz', sold: 2, deducted: 1 }];
    const { service } = setup({ data: { ticket_id: 't9', created: true, conflicts } });
    const r = await service.recordOfflineSale('m1', 'u1', 'caissier', 'o1', sale);
    expect(r.conflicts).toEqual(conflicts);
    expect(service.auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'offline_sale_with_conflicts' }));
  });

  it('the same sale sent again: the first is returned, nothing new in the journal', async () => {
    const { service } = setup({ data: { ticket_id: 't9', created: false, conflicts: [] } });
    const r = await service.recordOfflineSale('m1', 'u1', 'caissier', 'o1', sale);
    expect(r.created).toBe(false);
    expect(service.auditService.log).not.toHaveBeenCalled();
  });

  it('a product deleted meanwhile: refused with a clear reason (kept aside on the till)', async () => {
    const { service } = setup({ error: { message: 'POS_OFFLINE_ITEM_NOT_FOUND:a' } });
    await expect(service.recordOfflineSale('m1', 'u1', 'caissier', 'o1', sale)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('migration 074 missing: a server error (the till keeps the sale and retries), never a refusal', async () => {
    const { service } = setup({ error: { message: 'function public.record_offline_pos_sale does not exist' } });
    const err = await service.recordOfflineSale('m1', 'u1', 'caissier', 'o1', sale).catch((e: any) => e);
    expect(err).not.toBeInstanceOf(BadRequestException);
    expect(service.logger.error).toHaveBeenCalled();
  });
});
