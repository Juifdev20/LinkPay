import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RestockService } from './restock.service';
import { StockService } from '../stock/stock.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

function setup(opts: { status?: string; callerStation?: string; requestStation?: string; managers?: string[]; decidedBy?: string } = {}) {
  const writes: { table: string; payload: any }[] = [];
  const fake = createFakeSupabase((q: RecordedQuery) => {
    const m = (name: string) => q.calls.find((c) => c.method === name);
    switch (q.target) {
      case 'merchants':
        return m('in') ? { data: [{ id: 'm1', name: 'Goma' }] } : { data: { id: 'm1', name: 'Goma', owner_id: 'boss', organization_id: 'org1' } };
      case 'organization_staff':
        // maybeSingle: the caller's own station; a list: the station's active staff.
        if (m('maybeSingle')) return { data: { merchant_id: opts.callerStation ?? 'm1', deactivated_at: null } };
        return { data: (opts.managers ?? ['mgr']).map((user_id) => ({ user_id })) };
      case 'user_roles':
        return { data: (opts.managers ?? ['mgr']).map((user_id) => ({ user_id, role: { slug: 'gerant' } })) };
      case 'stock_items':
        return { data: [{ id: 'i1', name: 'Riz 5 kg', quantity: 2 }] };
      case 'restock_requests':
        if (m('insert')) { writes.push({ table: q.target, payload: m('insert')!.args[0] }); return { data: { id: 'r1', ...m('insert')!.args[0] } }; }
        if (m('update')) { writes.push({ table: q.target, payload: m('update')!.args[0] }); return { data: { id: 'r1', ...m('update')!.args[0] } }; }
        return { data: { id: 'r1', organization_id: 'org1', merchant_id: opts.requestStation ?? 'm1', status: opts.status ?? 'pending', requested_by: 'keeper', decided_by: opts.decidedBy ?? null } };
      default:
        return { data: null };
    }
  });
  const stock = new StockService(fake.service, {} as any, {} as any, {} as any, {} as any, {} as any);
  const orgs = { getOrganizationById: jest.fn(async () => ({ id: 'org1', owner_id: 'boss' })) };
  const notifications = { create: jest.fn(async () => undefined) };
  return { service: new RestockService(fake.service, stock, orgs as any, notifications as any), writes, notifications };
}

const mgr = { id: 'mgr', role: 'gerant', organization_id: 'org1' };
const keeper = { id: 'keeper', role: 'magasinier', organization_id: 'org1' };
const boss = { id: 'boss', role: 'enterprise' };

describe('restock requests (stock keeper → manager; owner only without a manager)', () => {
  it('a stock keeper asks; names and quantities come from the stock, and the station manager is told — not the owner', async () => {
    const { service, writes, notifications } = setup();
    await service.create('m1', keeper, { items: [{ stock_item_id: 'i1', wanted_qty: 20 }, { stock_item_id: 'other-station-item', wanted_qty: 5 }] });
    expect(writes[0].payload.items).toEqual([{ stock_item_id: 'i1', name: 'Riz 5 kg', current_qty: 2, wanted_qty: 20 }]);
    expect(writes[0].payload.status).toBeUndefined(); // pending
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'mgr', type: 'restock_request' }));
    expect(notifications.create).not.toHaveBeenCalledWith(expect.objectContaining({ user_id: 'boss' }));
  });

  it('a station without a manager: the request goes up to the owner', async () => {
    const { service, notifications } = setup({ managers: [] });
    await service.create('m1', keeper, { items: [{ stock_item_id: 'i1', wanted_qty: 3 }] });
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'boss' }));
  });

  it("a manager's own request is approved at once (they buy), nobody is troubled", async () => {
    const { service, writes, notifications } = setup();
    await service.create('m1', mgr, { items: [{ stock_item_id: 'i1', wanted_qty: 3 }] });
    expect(writes[0].payload).toEqual(expect.objectContaining({ status: 'approved', decided_by: 'mgr' }));
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('a cashier cannot ask, nor a manager of another station', async () => {
    await expect(setup().service.create('m1', { id: 'c', role: 'caissier', organization_id: 'org1' }, { items: [{ stock_item_id: 'i1', wanted_qty: 1 }] }))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(setup({ callerStation: 'm2' }).service.create('m1', mgr, { items: [{ stock_item_id: 'i1', wanted_qty: 1 }] }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it("the station's manager approves or refuses (the owner can too); the stock keeper never; the requester is told", async () => {
    await expect(setup().service.update('org1', 'r1', keeper, { status: 'approved' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(setup({ callerStation: 'm2' }).service.update('org1', 'r1', mgr, { status: 'approved' })).rejects.toBeInstanceOf(ForbiddenException);
    const byManager = setup();
    await byManager.service.update('org1', 'r1', mgr, { status: 'approved', note: 'Achat samedi' });
    expect(byManager.notifications.create).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'keeper', title: 'Réapprovisionnement validé' }));
    const byOwner = setup();
    await byOwner.service.update('org1', 'r1', boss, { status: 'rejected' });
    expect(byOwner.notifications.create).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'keeper', title: 'Réapprovisionnement refusé' }));
  });

  it('the station marks an approved request received — not a pending one, not another station — and the approver is told', async () => {
    const ok = setup({ status: 'approved', decidedBy: 'mgr' });
    await expect(ok.service.update('org1', 'r1', keeper, { status: 'received' })).resolves.toMatchObject({ status: 'received' });
    expect(ok.notifications.create).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'mgr', title: expect.stringContaining('Marchandise reçue') }));
    await expect(setup({ status: 'pending' }).service.update('org1', 'r1', mgr, { status: 'received' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup({ status: 'approved', requestStation: 'm2' }).service.update('org1', 'r1', mgr, { status: 'received' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a request already decided cannot be decided again', async () => {
    await expect(setup({ status: 'rejected' }).service.update('org1', 'r1', boss, { status: 'approved' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
