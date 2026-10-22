import { BadRequestException } from '@nestjs/common';
import { SalesService } from './sales.service';
import { createFakeSupabase, has, RecordedQuery } from '../test-utils/fake-supabase';

/** Cash taken for a sale whose QR a client is paying at the same moment: the client must never pay twice. */
function setup(requestStillOpen: boolean) {
  const sale = { id: 's1', reference: 'SALE-1', merchant_id: 'st1', created_by: 'u1', status: 'PENDING', payment_request_id: 'pr1' };
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'payment_requests') return { data: requestStillOpen ? { id: 'pr1' } : null };
    if (q.target === 'sales' && has(q, 'update')) return { data: { ...sale, status: 'PAID', payment_method: 'cash' } };
    if (q.target === 'sales') return { data: sale };
    if (q.target === 'sale_items') return { data: [] };
    return { data: null };
  });
  const service: any = Object.create(SalesService.prototype);
  service.supabaseService = fake.service;
  service.db = () => fake.service.getClient();
  jest.spyOn(service, 'assertOrgAccess').mockResolvedValue('st1');
  return { service, fake };
}

describe('Ventes — cash and ScanLinkPay on the same sale', () => {
  it('closes the payment QR before taking the cash', async () => {
    const { service, fake } = setup(true);
    const r = await service.payCash('o1', 's1', 'u1', 'o1', 'vendeur');
    expect(r).toMatchObject({ status: 'PAID', payment_method: 'cash' });
    const targets = fake.queries.map((q) => q.target);
    expect(targets.indexOf('payment_requests')).toBeLessThan(targets.lastIndexOf('sales'));
    expect(has(fake.queries.find((q) => q.target === 'payment_requests')!, 'eq', 'status', 'CREATED')).toBe(true);
  });

  it('refuses the cash when the client is already paying by ScanLinkPay', async () => {
    const { service, fake } = setup(false);
    await expect(service.payCash('o1', 's1', 'u1', 'o1', 'vendeur')).rejects.toBeInstanceOf(BadRequestException);
    expect(fake.queries.some((q) => q.target === 'sales' && has(q, 'update'))).toBe(false);
  });
});

describe('Ventes — the customer leaves without paying', () => {
  function cancelSetup(requestStillOpen: boolean, status = 'PENDING') {
    const fake = createFakeSupabase((q: RecordedQuery) => {
      if (q.target === 'payment_requests') return { data: requestStillOpen ? { id: 'pr1' } : null };
      if (q.target === 'sales' && has(q, 'update')) return { data: { id: 's1', status: 'CANCELLED' } };
      if (q.target === 'sales') return { data: { id: 's1', status, payment_request_id: 'pr1', merchant_id: 'st1' } };
      return { data: null };
    });
    const service: any = Object.create(SalesService.prototype);
    service.db = () => fake.service.getClient();
    jest.spyOn(service, 'assertOrgAccess').mockResolvedValue('st1');
    return { service, fake };
  }

  it('cancels the sale and closes its QR', async () => {
    const { service } = cancelSetup(true);
    await expect(service.cancelSale('o1', 's1', 'u1', 'o1', 'vendeur')).resolves.toMatchObject({ status: 'CANCELLED' });
  });

  it('refuses while the client is paying by ScanLinkPay', async () => {
    const { service, fake } = cancelSetup(false);
    await expect(service.cancelSale('o1', 's1', 'u1', 'o1', 'vendeur')).rejects.toBeInstanceOf(BadRequestException);
    expect(fake.queries.some((q) => q.target === 'sales' && has(q, 'update'))).toBe(false);
  });

  it('a paid sale cannot be cancelled', async () => {
    const { service } = cancelSetup(true, 'PAID');
    await expect(service.cancelSale('o1', 's1', 'u1', 'o1', 'vendeur')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("Ventes — the owner's sale belongs to the station holding the articles", () => {
  function ownerSetup(itemStations: string[], stationInOrg = true) {
    const fake = createFakeSupabase((q: RecordedQuery) => {
      if (q.target === 'stock_items') return { data: itemStations.map((m) => ({ merchant_id: m })) };
      if (q.target === 'merchants') return { data: stationInOrg ? { id: itemStations[0], name: 'Station 2' } : null };
      return { data: null };
    });
    const service: any = Object.create(SalesService.prototype);
    service.db = () => fake.service.getClient();
    jest.spyOn(service, 'getOrgMerchant').mockResolvedValue({ id: 'first' });
    return service;
  }

  it('sells from the second station, not the first one', async () => {
    await expect(ownerSetup(['st2', 'st2']).ownerSaleStation('o1', ['a', 'b'])).resolves.toMatchObject({ id: 'st2' });
  });

  it('refuses one sale over two stations', async () => {
    await expect(ownerSetup(['st1', 'st2']).ownerSaleStation('o1', ['a', 'b'])).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuses a station of another business", async () => {
    await expect(ownerSetup(['other'], false).ownerSaleStation('o1', ['a'])).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Ventes — the last unit sold by another sale meanwhile', () => {
  function stockSetup(left: number) {
    const fake = createFakeSupabase((q: RecordedQuery) => {
      if (q.target === 'sales' && has(q, 'update')) return { data: { id: 's1', status: 'PAID' } };
      if (q.target === 'sales') return { data: { id: 's1', reference: 'SALE-1', merchant_id: 'st1', created_by: 'u1', status: 'PENDING', payment_request_id: 'pr1' } };
      if (q.target === 'sale_items') return { data: [{ stock_item_id: 'phone', quantity: 1, name: 'Galaxy A15' }] };
      if (q.target === 'stock_items' && has(q, 'in')) return { data: [{ id: 'phone', quantity: left }] };
      if (q.target === 'stock_items') return { data: { quantity: left } };
      if (q.target === 'payment_requests') return { data: { id: 'pr1' } };
      return { data: null };
    });
    const service: any = Object.create(SalesService.prototype);
    service.db = () => fake.service.getClient();
    service.logger = { error: jest.fn() };
    jest.spyOn(service, 'assertOrgAccess').mockResolvedValue('st1');
    return { service, fake };
  }

  it('refuses the cash: the phone is no longer on the shelf', async () => {
    const { service, fake } = stockSetup(0);
    await expect(service.payCash('o1', 's1', 'u1', 'o1', 'vendeur')).rejects.toThrow(/plus en stock/);
    expect(fake.queries.some((q) => q.target === 'payment_requests')).toBe(false);
  });

  it('a payment already made never fails on the stock: nothing below zero, logged for the inventory', async () => {
    const { service, fake } = stockSetup(0);
    await service.releaseStock({ id: 's1', reference: 'SALE-1', merchant_id: 'st1', created_by: 'u1' });
    expect(fake.queries.some((q) => q.target === 'stock_movements')).toBe(false);
    expect(service.logger.error).toHaveBeenCalled();
  });

  it('in stock: the cash is taken and the unit leaves the shelf', async () => {
    const { service, fake } = stockSetup(3);
    await service.payCash('o1', 's1', 'u1', 'o1', 'vendeur');
    const movement = fake.queries.find((q) => q.target === 'stock_movements')!;
    expect(has(movement, 'insert', { stock_item_id: 'phone', merchant_id: 'st1', type: 'out', quantity_delta: -1, reason: 'Vente SALE-1', created_by: 'u1' })).toBe(true);
  });
});
