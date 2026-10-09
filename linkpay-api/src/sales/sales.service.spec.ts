import { BadRequestException } from '@nestjs/common';
import { SalesService } from './sales.service';
import { createFakeSupabase, has, RecordedQuery } from '../test-utils/fake-supabase';

const ITEM = { id: 'i1', name: 'Téléphone', quantity: 5, unit_price_cents: 100000, cost_price_cents: 60000, currency: 'CDF', merchant_id: 'm1' };

function setup() {
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'stock_items') return { data: [ITEM] };
    if (q.target === 'payment_requests') return { data: { id: 'pr1', link_token: 'tok' } };
    if (q.target === 'sales') return { data: { id: 's1' } };
    return { data: null };
  });
  // (supabase, stockPasswordService, ...) — only the first matters for createSale
  const service: any = new (SalesService as any)(fake.service, {}, {}, {}, {});
  jest.spyOn(service, 'assertOrgAccess').mockResolvedValue(undefined);
  jest.spyOn(service, 'getOrgMerchant').mockResolvedValue({ id: 'm1' });
  return { service, fake };
}

describe('SalesService.createSale', () => {
  it('prices the sale from the stock, never from what the client sends', async () => {
    const { service, fake } = setup();
    await service.createSale('o1', 'u1', 'o1', [{ stock_item_id: 'i1', quantity: 2, unit_price_cents: 1 } as any]);
    const request = fake.queries.find((q) => q.target === 'payment_requests' && has(q, 'insert'))!;
    expect(request.calls.find((c) => c.method === 'insert')!.args[0].amount_cents).toBe(200000);
  });

  it('refuses more than is in stock', async () => {
    const { service } = setup();
    await expect(service.createSale('o1', 'u1', 'o1', [{ stock_item_id: 'i1', quantity: 6 }])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to oversell by splitting an article over several lines (3 + 3 of 5 in stock)', async () => {
    const { service, fake } = setup();
    await expect(
      service.createSale('o1', 'u1', 'o1', [{ stock_item_id: 'i1', quantity: 3 }, { stock_item_id: 'i1', quantity: 3 }]),
    ).rejects.toThrow(/Stock insuffisant/);
    expect(fake.queries.some((q) => q.target === 'sales' && has(q, 'insert'))).toBe(false);
  });

  it('accepts several lines of the same article when the total fits the stock (2 + 3 of 5)', async () => {
    const { service } = setup();
    await expect(
      service.createSale('o1', 'u1', 'o1', [{ stock_item_id: 'i1', quantity: 2 }, { stock_item_id: 'i1', quantity: 3 }]),
    ).resolves.toBeDefined();
  });

  it.each([[0], [-1], [1.5]])('refuses quantity %s', async (quantity) => {
    const { service } = setup();
    await expect(service.createSale('o1', 'u1', 'o1', [{ stock_item_id: 'i1', quantity }])).rejects.toBeInstanceOf(BadRequestException);
  });
});
