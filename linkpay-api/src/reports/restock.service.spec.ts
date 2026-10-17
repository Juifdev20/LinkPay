import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RestockService } from './restock.service';
import { StockService } from '../stock/stock.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

function setup(opts: { status?: string; callerStation?: string; requestStation?: string } = {}) {
  const writes: { table: string; payload: any }[] = [];
  const fake = createFakeSupabase((q: RecordedQuery) => {
    const m = (name: string) => q.calls.find((c) => c.method === name);
    switch (q.target) {
      case 'merchants':
        return m('in') ? { data: [{ id: 'm1', name: 'Goma' }] } : { data: { id: 'm1', name: 'Goma', owner_id: 'boss', organization_id: 'org1' } };
      case 'organization_staff':
        return { data: { merchant_id: opts.callerStation ?? 'm1', deactivated_at: null } };
      case 'stock_items':
        return { data: [{ id: 'i1', name: 'Riz 5 kg', quantity: 2 }] };
      case 'restock_requests':
        if (m('insert')) { writes.push({ table: q.target, payload: m('insert')!.args[0] }); return { data: { id: 'r1', ...m('insert')!.args[0] } }; }
        if (m('update')) { writes.push({ table: q.target, payload: m('update')!.args[0] }); return { data: { id: 'r1', ...m('update')!.args[0] } }; }
        return { data: { id: 'r1', organization_id: 'org1', merchant_id: opts.requestStation ?? 'm1', status: opts.status ?? 'pending', requested_by: 'mgr' } };
      default:
        return { data: null };
    }
  });
  const stock = new StockService(fake.service, {} as any, {} as any, {} as any, {} as any);
  const orgs = { getOrganizationById: jest.fn(async () => ({ id: 'org1', owner_id: 'boss' })) };
  const notifications = { create: jest.fn(async () => undefined) };
  return { service: new RestockService(fake.service, stock, orgs as any, notifications as any), writes, notifications };
}

const mgr = { id: 'mgr', role: 'gerant', organization_id: 'org1' };
const boss = { id: 'boss', role: 'enterprise' };

describe('restock requests', () => {
  it('a station manager asks; names and quantities come from the stock, and the owner is told', async () => {
    const { service, writes, notifications } = setup();
    await service.create('m1', mgr, { items: [{ stock_item_id: 'i1', wanted_qty: 20 }, { stock_item_id: 'other-station-item', wanted_qty: 5 }] });
    expect(writes[0].payload.items).toEqual([{ stock_item_id: 'i1', name: 'Riz 5 kg', current_qty: 2, wanted_qty: 20 }]);
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'boss', type: 'restock_request' }));
  });

  it('a cashier cannot ask, nor a manager of another station', async () => {
    await expect(setup().service.create('m1', { id: 'c', role: 'caissier', organization_id: 'org1' }, { items: [{ stock_item_id: 'i1', wanted_qty: 1 }] }))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(setup({ callerStation: 'm2' }).service.create('m1', mgr, { items: [{ stock_item_id: 'i1', wanted_qty: 1 }] }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('only the owner approves or refuses, and the requester is told', async () => {
    await expect(setup().service.update('org1', 'r1', mgr, { status: 'approved' })).rejects.toBeInstanceOf(ForbiddenException);
    const { service, notifications } = setup();
    await service.update('org1', 'r1', boss, { status: 'approved', note: 'Achat samedi' });
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'mgr', title: 'Réapprovisionnement validé' }));
  });

  it('the station marks an approved request received — not a pending one, not another station', async () => {
    await expect(setup({ status: 'approved' }).service.update('org1', 'r1', mgr, { status: 'received' })).resolves.toMatchObject({ status: 'received' });
    await expect(setup({ status: 'pending' }).service.update('org1', 'r1', mgr, { status: 'received' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup({ status: 'approved', requestStation: 'm2' }).service.update('org1', 'r1', mgr, { status: 'received' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a request already decided cannot be decided again', async () => {
    await expect(setup({ status: 'rejected' }).service.update('org1', 'r1', boss, { status: 'approved' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
