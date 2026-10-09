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

describe('cost prices are never sent to sellers and cashiers', () => {
  const SALE = { id: 's1', organization_id: 'o1', payment_request_id: null, sale_items: [{ name: 'Téléphone', quantity: 1, unit_price_cents: 100000, unit_cost_cents: 60000 }] };
  function make() {
    const fake = createFakeSupabase((q: RecordedQuery) => {
      if (q.target === 'sales' && has(q, 'select', '*, sale_items(*)')) return { data: SALE };
      if (q.target === 'sales') return { data: [{ id: 's1', currency: 'CDF', total_cents: 100000, paid_at: '2026-06-01', transaction_id: null, sale_items: SALE.sale_items }] };
      return { data: null };
    });
    const service: any = new (SalesService as any)(fake.service, {}, {}, {}, {});
    jest.spyOn(service, 'assertOrgAccess').mockResolvedValue(undefined);
    return service;
  }

  it.each(['vendeur', 'caissier'])('a %s gets the sale lines and the statistics without cost or margin', async (role) => {
    const service = make();
    const sale = await service.getSale('o1', 's1', 'u1', 'o1', role);
    expect(JSON.stringify(sale)).not.toContain('unit_cost_cents');
    expect(sale.sale_items[0].unit_price_cents).toBe(100000);
    const stats = await service.getStats('o1', 'u1', 'o1', undefined, undefined, role);
    expect(stats).not.toHaveProperty('cost');
    expect(stats).not.toHaveProperty('gross_margin');
    expect(stats).not.toHaveProperty('net_margin');
    expect(stats.revenue).toBeDefined();
  });

  it('the owner and the accountant still see them', async () => {
    const service = make();
    for (const role of ['enterprise', 'comptable']) {
      expect((await service.getSale('o1', 's1', 'u1', 'o1', role)).sale_items[0].unit_cost_cents).toBe(60000);
      expect(await service.getStats('o1', 'u1', 'o1', undefined, undefined, role)).toHaveProperty('gross_margin');
    }
  });
});
