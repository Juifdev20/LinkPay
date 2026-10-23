import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SupplierOrdersService } from './supplier-orders.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

const DAY = 86_400_000;
const future = () => new Date(Date.now() + 10 * DAY).toISOString();
const past = () => new Date(Date.now() - DAY).toISOString();

function setup(opts: { order?: any; profile?: any; catalog?: any[]; stock?: any[]; clientStock?: any[]; requestClosable?: boolean } = {}) {
  const writes: { table: string; method: string; payload: any }[] = [];
  const profile = opts.profile ?? { organization_id: 'sup', merchant_id: 'sm', display_name: 'Grossiste', active: true, trial_ends_at: future(), plan_expires_at: null };
  const fake = createFakeSupabase((q: RecordedQuery) => {
    const m = (name: string) => q.calls.find((c) => c.method === name);
    const write = m('insert') || m('update');
    if (write) writes.push({ table: q.target, method: write.method, payload: write.args[0] });
    switch (q.target) {
      case 'supplier_orders':
        if (m('insert')) return { data: { id: 'o1', ...m('insert')!.args[0] } };
        if (m('update')) return { data: { id: 'o1' } };
        return { data: opts.order ? { items: [], ...opts.order } : null };
      case 'supplier_catalog_items':
        return { data: opts.catalog ?? [] };
      case 'stock_items':
        return { data: m('eq') && m('eq')!.args[1] === 'cm' ? (opts.clientStock ?? []) : (opts.stock ?? []) };
      case 'payment_requests':
        if (m('insert')) return { data: { id: 'pr1' } };
        if (m('update')) return { data: opts.requestClosable === false ? null : { id: 'pr1' } };
        return { data: opts.requestClosable === false ? { status: 'PENDING' } : [] };
      case 'stock_movements':
        return { data: [] };
      case 'suppliers':
        return { data: { id: 'sup-entry' } };
      default:
        return { data: [] };
    }
  });
  const network = {
    member: jest.fn(async (orgId: string, caller: any) => {
      if (caller.id === 'boss' || caller.id === 'sboss') return { org: { id: orgId, name: 'Client SARL' }, isOwner: true, station: null };
      if (caller.role === 'magasinier' && caller.organization_id === orgId) return { org: { id: orgId }, isOwner: false, station: 'cm' };
      throw new ForbiddenException('no');
    }),
    stationsOf: jest.fn(async () => [{ id: 'cm' }]),
    assertLinked: jest.fn(async () => undefined),
    profileOf: jest.fn(async () => profile),
    supplierRecipients: jest.fn(async () => ['sboss']),
    clientRecipients: jest.fn(async () => ['boss']),
    notify: jest.fn(async () => undefined),
    fail: (e: any) => { throw new Error(e.message); },
  };
  const plan = { assertCanSell: jest.fn((p: any) => { if (new Date(p.trial_ends_at).getTime() < Date.now() && !p.plan_expires_at) throw new ForbiddenException('plan'); }) };
  const stock = {
    createMovement: jest.fn(async () => ({})),
    createItem: jest.fn(async (_m: string, _c: string, _r: string, _o: any, data: any) => ({ id: 'new-item', ...data })),
  };
  const service = new SupplierOrdersService(fake.service, stock as any, network as any, plan as any);
  jest.spyOn(service, 'get').mockImplementation(async () => ({}) as any);
  return { service, writes, stock, network };
}

const boss = { id: 'boss', role: 'enterprise' };
const sboss = { id: 'sboss', role: 'enterprise' };

describe('orders between enterprises (all sectors)', () => {
  const catalog = [
    { id: 'c1', stock_item_id: 's1', price_cents: 500, currency: 'USD', min_quantity: 1 },
    { id: 'c2', stock_item_id: 's2', price_cents: 900, currency: 'USD', min_quantity: 5 },
  ];
  const stock = [{ id: 's1', name: 'Riz 25 kg', barcode: '111', category: 'epicerie', merchant_id: 'sm' }, { id: 's2', name: 'Huile 5 L', barcode: '222', merchant_id: 'sm' }];

  it('prices and names come from the catalog; the total is computed here', async () => {
    const { service, writes, network } = setup({ catalog, stock });
    await service.create('cli', boss, { supplier_org_id: 'sup', items: [{ catalog_item_id: 'c1', quantity: 4 }, { catalog_item_id: 'c2', quantity: 5 }], delivery_requested: true });
    const order = writes.find((w) => w.table === 'supplier_orders')!.payload;
    expect(order).toMatchObject({ client_merchant_id: 'cm', supplier_merchant_id: 'sm', currency: 'USD', subtotal_cents: 4 * 500 + 5 * 900, delivery_requested: true });
    const lines = writes.find((w) => w.table === 'supplier_order_items')!.payload;
    expect(lines.map((l: any) => [l.name, l.unit_price_cents, l.quantity])).toEqual([['Riz 25 kg', 500, 4], ['Huile 5 L', 900, 5]]);
    expect(network.notify).toHaveBeenCalledWith(['sboss'], 'boss', expect.objectContaining({ title: expect.stringContaining('Nouvelle commande') }));
  });

  it('refused below the minimum quantity, across currencies, or when the supplier plan has ended', async () => {
    await expect(setup({ catalog, stock }).service.create('cli', boss, { supplier_org_id: 'sup', items: [{ catalog_item_id: 'c2', quantity: 2 }] }))
      .rejects.toThrow(/au moins 5/);
    const mixed = [catalog[0], { ...catalog[1], currency: 'CDF' }];
    await expect(setup({ catalog: mixed, stock }).service.create('cli', boss, { supplier_org_id: 'sup', items: [{ catalog_item_id: 'c1', quantity: 1 }, { catalog_item_id: 'c2', quantity: 5 }] }))
      .rejects.toThrow(/une seule devise/);
    const ended = { organization_id: 'sup', merchant_id: 'sm', active: true, trial_ends_at: past(), plan_expires_at: null };
    await expect(setup({ catalog, stock, profile: ended }).service.create('cli', boss, { supplier_org_id: 'sup', items: [{ catalog_item_id: 'c1', quantity: 1 }] }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it("the supplier confirms with this order's delivery fee: total = products + fee, and a ScanLinkPay link to its station", async () => {
    const order = { id: 'o1', number: 'CMD-1', status: 'submitted', supplier_org_id: 'sup', client_org_id: 'cli', supplier_merchant_id: 'sm', client_merchant_id: 'cm', subtotal_cents: 6500, currency: 'USD', delivery_requested: true };
    const { service, writes } = setup({ order });
    await service.confirm('sup', 'o1', sboss, { delivery_fee_cents: 700 });
    expect(writes.find((w) => w.table === 'payment_requests')!.payload).toMatchObject({ merchant_id: 'sm', amount_cents: 7200, currency: 'USD', status: 'CREATED' });
    expect(writes.find((w) => w.table === 'supplier_orders')!.payload).toMatchObject({ status: 'confirmed', delivery_fee_cents: 700, total_cents: 7200, payment_request_id: 'pr1' });
  });

  it('a payment outside the app: confirmed by the supplier only, after its ScanLinkPay link is closed — never while someone is paying it', async () => {
    const order = { id: 'o1', number: 'CMD-1', status: 'confirmed', supplier_org_id: 'sup', client_org_id: 'cli', supplier_merchant_id: 'sm', client_merchant_id: 'cm', total_cents: 7200, currency: 'USD', payment_request_id: 'pr1' };
    const ok = setup({ order });
    await ok.service.confirmPayment('sup', 'o1', sboss, { method: 'cash' });
    expect(ok.writes.find((w) => w.table === 'supplier_orders')!.payload).toMatchObject({ status: 'paid', payment_method: 'cash' });
    await expect(setup({ order, requestClosable: false }).service.confirmPayment('sup', 'o1', sboss, { method: 'cash' })).rejects.toThrow(/en cours/);
    // The client may only announce it.
    const announced = setup({ order });
    await announced.service.declarePayment('cli', 'o1', boss, { method: 'mobile_money', reference: 'MP123' });
    expect(announced.writes.find((w) => w.table === 'supplier_orders')!.payload.status).toBeUndefined();
  });

  it('delivery: refused when the shipping station lacks stock; otherwise its stock goes out once per line', async () => {
    const items = [{ id: 'l1', name: 'Riz 25 kg', quantity: 4, supplier_stock_item_id: 's1', out_ref: 'r1' }];
    const order = { id: 'o1', number: 'CMD-1', status: 'paid', supplier_org_id: 'sup', client_org_id: 'cli', supplier_merchant_id: 'sm', client_merchant_id: 'cm', items };
    await expect(setup({ order, stock: [{ id: 's1', quantity: 3 }] }).service.deliver('sup', 'o1', sboss)).rejects.toThrow(/il ne reste que 3/);
    const ok = setup({ order, stock: [{ id: 's1', quantity: 10 }] });
    await ok.service.deliver('sup', 'o1', sboss);
    expect(ok.stock.createMovement).toHaveBeenCalledWith('sm', 's1', 'sboss', 'enterprise', undefined, expect.objectContaining({ type: 'out', quantity_delta: -4, client_ref: 'r1' }));
  });

  it('reception: same barcode → that product (purchase price updated); a new product needs its sale price; stock comes in once', async () => {
    const items = [
      { id: 'l1', name: 'Riz 25 kg', barcode: '111', quantity: 4, unit_price_cents: 500, in_ref: 'i1' },
      { id: 'l2', name: 'Huile 5 L', barcode: '222', quantity: 5, unit_price_cents: 900, in_ref: 'i2' },
    ];
    const order = { id: 'o1', number: 'CMD-1', status: 'delivered', supplier_org_id: 'sup', client_org_id: 'cli', supplier_merchant_id: 'sm', client_merchant_id: 'cm', currency: 'USD', items };
    const clientStock = [{ id: 'mine', name: 'Riz Lion', barcode: '111', currency: 'USD' }];
    await expect(setup({ order, clientStock }).service.receive('cli', 'o1', boss, {})).rejects.toThrow(/nouveau chez vous/);

    const ok = setup({ order, clientStock });
    await ok.service.receive('cli', 'o1', boss, { lines: [{ order_item_id: 'l2', sale_price_cents: 1200 }] });
    expect(ok.writes.find((w) => w.table === 'stock_items' && w.payload.cost_price_cents === 500)).toBeTruthy();
    expect(ok.stock.createItem).toHaveBeenCalledWith('cm', 'boss', 'enterprise', undefined, expect.objectContaining({ name: 'Huile 5 L', unit_price_cents: 1200, cost_price_cents: 900, supplier_id: 'sup-entry' }));
    expect(ok.stock.createMovement).toHaveBeenCalledWith('cm', 'mine', 'boss', 'enterprise', undefined, expect.objectContaining({ type: 'in', quantity_delta: 4, client_ref: 'i1' }));
    expect(ok.stock.createMovement).toHaveBeenCalledWith('cm', 'new-item', 'boss', 'enterprise', undefined, expect.objectContaining({ type: 'in', quantity_delta: 5, client_ref: 'i2' }));
  });

  it('a paid payment request marks its order paid once', async () => {
    const order = { id: 'o1', number: 'CMD-1', status: 'confirmed', supplier_org_id: 'sup', client_org_id: 'cli', client_merchant_id: 'cm', total_cents: 7200, currency: 'USD' };
    const { service, writes } = setup({ order });
    await expect(service.markPaidByPaymentRequest('pr1', 'tx1')).resolves.toBe(true);
    expect(writes.find((w) => w.table === 'supplier_orders')!.payload).toMatchObject({ status: 'paid', payment_method: 'scanlinkpay', transaction_id: 'tx1' });
    await expect(setup({ order: { ...order, status: 'paid' } }).service.markPaidByPaymentRequest('pr1', 'tx1')).resolves.toBe(false);
  });

  it("another enterprise's staff sees nothing", async () => {
    const order = { id: 'o1', status: 'submitted', supplier_org_id: 'sup', client_org_id: 'cli', supplier_merchant_id: 'sm', client_merchant_id: 'cm' };
    await expect(setup({ order }).service.confirm('other', 'o1', sboss, {})).rejects.toThrow(/introuvable/);
    await expect(setup({ order }).service.confirm('cli', 'o1', boss, {})).rejects.toThrow(/introuvable/); // the client cannot confirm
    void BadRequestException;
  });
});
