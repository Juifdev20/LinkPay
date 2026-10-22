import { BadRequestException } from '@nestjs/common';
import { SalesService } from './sales.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

function setup(rpc: { data?: any; error?: { message: string } }, station: string | null = 'st1') {
  const fake = createFakeSupabase((q: RecordedQuery) => (q.target === 'rpc:record_offline_org_sale' ? rpc : { data: null }));
  const service: any = Object.create(SalesService.prototype);
  service.supabaseService = fake.service;
  service.db = () => fake.service.getClient();
  service.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  service.auditService = { log: jest.fn(async () => undefined) };
  jest.spyOn(service, 'assertOrgAccess').mockResolvedValue(station);
  jest.spyOn(service, 'getOrgMerchant').mockResolvedValue({ id: 'main-shop' });
  jest.spyOn(service, 'getSale').mockResolvedValue({ id: 's9', reference: 'SALE-HL-ABC', status: 'PAID' });
  return { service, fake };
}

const dto = {
  client_ref: '9b2f6a1e-1c4d-4b8e-9f00-2a7c3d4e5f60',
  sold_at: '2026-10-22T08:00:00.000Z',
  items: [
    { stock_item_id: 'a', quantity: 1, unit_price_cents: 25000 },
    { stock_item_id: 'a', quantity: 1, unit_price_cents: 25000 },
    { stock_item_id: 'b', quantity: 1, unit_price_cents: 1500 },
  ],
};

describe('Ventes — sales made offline', () => {
  it("records the sale on the seller's own station, taps of the same product merged, once", async () => {
    const { service, fake } = setup({ data: { sale_id: 's9', created: true, conflicts: [] } });
    const r = await service.recordOfflineSale('o1', 'u1', 'o1', dto, 'vendeur');
    const call = fake.queries.find((q) => q.target === 'rpc:record_offline_org_sale')!.calls[0].args[0];
    expect(call).toMatchObject({ p_org_id: 'o1', p_merchant_id: 'st1', p_seller_id: 'u1', p_client_ref: dto.client_ref });
    expect(call.p_items).toEqual([{ stock_item_id: 'a', quantity: 2, unit_price_cents: 25000 }, { stock_item_id: 'b', quantity: 1, unit_price_cents: 1500 }]);
    expect(r).toMatchObject({ id: 's9', created: true });
    expect(service.auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'offline_sale_recorded', entity_type: 'sale' }));
  });

  it("the owner (no station) sells for the business's shop", async () => {
    const { service, fake } = setup({ data: { sale_id: 's9', created: true, conflicts: [] } }, null);
    await service.recordOfflineSale('o1', 'owner', undefined, dto, 'enterprise');
    expect(fake.queries.find((q) => q.target === 'rpc:record_offline_org_sale')!.calls[0].args[0].p_merchant_id).toBe('main-shop');
  });

  it('sent again: no new journal line', async () => {
    const { service } = setup({ data: { sale_id: 's9', created: false, conflicts: [] } });
    await service.recordOfflineSale('o1', 'u1', 'o1', dto, 'vendeur');
    expect(service.auditService.log).not.toHaveBeenCalled();
  });

  it('a product deleted meanwhile is refused with a clear reason', async () => {
    const { service } = setup({ error: { message: 'SALE_OFFLINE_ITEM_NOT_FOUND:a' } });
    await expect(service.recordOfflineSale('o1', 'u1', 'o1', dto, 'vendeur')).rejects.toBeInstanceOf(BadRequestException);
  });
});
