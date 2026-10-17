import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { StockService } from './stock.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

function setup(opts: { verify?: () => Promise<void>; required?: boolean } = {}) {
  const fake = createFakeSupabase((q: RecordedQuery) =>
    q.target === 'merchants' ? { data: { id: 'm1', owner_id: 'boss', organization_id: 'org1' } }
      : q.target === 'organization_staff' ? { data: { merchant_id: 'm1', deactivated_at: null } } : { data: null });
  const stockPasswords = { verifyPassword: jest.fn(opts.verify ?? (async () => undefined)), isRequired: jest.fn(async () => opts.required ?? true) };
  const service = new StockService(fake.service, {} as any, {} as any, stockPasswords as any, { log: jest.fn() } as any);
  return { service, stockPasswords };
}

describe('StockService.assertManagementPassword — the patron\'s shared password for adding stock, movements, inventories', () => {
  it('asks for the password when none is sent (so the app can prompt for it)', async () => {
    const { service, stockPasswords } = setup();
    const err: any = await service.assertManagementPassword('m1', 'boss', 'enterprise', undefined, undefined).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse().code).toBe('STOCK_PASSWORD_REQUIRED');
    expect(stockPasswords.verifyPassword).not.toHaveBeenCalled();
  });

  it('accepts the right password, checked against the organization of the store', async () => {
    const { service, stockPasswords } = setup();
    await expect(service.assertManagementPassword('m1', 'boss', 'enterprise', undefined, 'secret')).resolves.toBeUndefined();
    expect(stockPasswords.verifyPassword).toHaveBeenCalledWith('org1', 'secret');
  });

  it('reports a wrong password or a lock-out with its reason, as STOCK_PASSWORD_INVALID', async () => {
    const { service } = setup({ verify: async () => { throw new BadRequestException('Mot de passe incorrect (3 tentative(s) restante(s)).'); } });
    const err: any = await service.assertManagementPassword('m1', 'boss', 'enterprise', undefined, 'nope').catch((e) => e);
    expect(err.getResponse()).toMatchObject({ code: 'STOCK_PASSWORD_INVALID', message: expect.stringContaining('3 tentative') });
  });

  it('does not ask administrators, and still refuses someone with no access to the store', async () => {
    const { service } = setup();
    await expect(service.assertManagementPassword('m1', 'a1', 'super_admin', undefined, undefined)).resolves.toBeUndefined();
    await expect(service.assertManagementPassword('m1', 'stranger', 'client', undefined, 'secret')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a magasinier of the same organization can use it', async () => {
    const { service } = setup();
    await expect(service.assertManagementPassword('m1', 'emp', 'magasinier', 'org1', 'secret')).resolves.toBeUndefined();
  });
});

describe('who did it — edits and deletions are recorded under the person\'s own account', () => {
  function withAudit() {
    const fake = createFakeSupabase((q: RecordedQuery) => {
      if (q.target === 'merchants') return { data: { id: 'm1', owner_id: 'boss', organization_id: 'org1' } };
      if (q.target === 'organization_staff') return { data: { merchant_id: 'm1', deactivated_at: null } };
      if (q.target === 'stock_items' && q.calls.some((c) => c.method === 'maybeSingle')) return { data: { name: 'Samsung A15', quantity: 12, unit_price_cents: 90000 } };
      if (q.target === 'stock_items' && q.calls.some((c) => c.method === 'single')) return { data: { name: 'Samsung A15', quantity: 12, unit_price_cents: 90000 } };
      return { data: null };
    });
    const audit = { log: jest.fn(async () => undefined) };
    const passwords = { verifyPassword: jest.fn(async () => undefined), isRequired: jest.fn(async () => true) };
    return { service: new StockService(fake.service, {} as any, {} as any, passwords as any, audit as any), audit };
  }

  it('a deleted article is logged with what it was and who removed it', async () => {
    const { service, audit } = withAudit();
    await service.deleteItem('m1', 'item1', 'emp-1', 'magasinier', 'org1', 'pw');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'emp-1', action: 'stock_item_deleted', entity_id: 'item1',
      changes: expect.objectContaining({ item: expect.objectContaining({ name: 'Samsung A15', quantity: 12 }) }),
    }));
  });

  it('an edit is logged with the old and new values of what changed', async () => {
    const { service, audit } = withAudit();
    await service.updateItem('m1', 'item1', 'emp-1', 'magasinier', 'org1', { unit_price_cents: 50000 }, 'pw').catch(() => undefined);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'emp-1', action: 'stock_item_updated',
      changes: expect.objectContaining({ fields: { unit_price_cents: { from: 90000, to: 50000 } } }),
    }));
  });
});

describe('selling staff never see what the shop paid for an item', () => {
  const items = [{ id: 'i1', merchant_id: 'm1', name: 'Samsung A15', unit_price_cents: 90000, cost_price_cents: 60000, quantity: 3 }];
  const build = () => {
    const fake = createFakeSupabase((q: RecordedQuery) => {
      if (q.target === 'merchants') return { data: { id: 'm1', owner_id: 'boss', organization_id: 'org1' } };
      if (q.target === 'organization_staff') return { data: { merchant_id: 'm1', deactivated_at: null } };
      if (q.target === 'stock_items') return { data: items };
      return { data: null };
    });
    return new StockService(fake.service, {} as any, {} as any, {} as any, {} as any);
  };

  it('vendeur and caissier get price and quantity, without cost_price_cents', async () => {
    for (const role of ['vendeur', 'caissier']) {
      const list = await build().listItems('m1', 'emp', role, 'org1');
      expect(list[0]).toMatchObject({ name: 'Samsung A15', unit_price_cents: 90000, quantity: 3 });
      expect(list[0]).not.toHaveProperty('cost_price_cents');
    }
  });

  it('the patron and the stock keeper still see the cost', async () => {
    expect((await build().listItems('m1', 'boss', 'enterprise', undefined))[0].cost_price_cents).toBe(60000);
    expect((await build().listItems('m1', 'emp', 'magasinier', 'org1'))[0].cost_price_cents).toBe(60000);
  });

  it('the movement history is no longer open to sellers', async () => {
    await expect(build().listMovements('m1', 'i1', 'emp', 'vendeur', 'org1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('stations — staff only reach the station they work in', () => {
  const build = (station: string | null, deactivated = false) => {
    const fake = createFakeSupabase((q: RecordedQuery) => {
      if (q.target === 'merchants') return { data: { id: 'm1', owner_id: 'boss', organization_id: 'org1' } };
      if (q.target === 'organization_staff') return { data: { merchant_id: station, deactivated_at: deactivated ? '2026-10-01' : null } };
      if (q.target === 'stock_items') return { data: [] };
      return { data: null };
    });
    return new StockService(fake.service, {} as any, {} as any, {} as any, {} as any);
  };

  it('a cashier of station A is refused at station B', async () => {
    await expect(build('m2').listItems('m1', 'emp', 'caissier', 'org1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a staff member with no station yet, or whose access was removed, reaches none', async () => {
    await expect(build(null).listItems('m1', 'emp', 'caissier', 'org1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(build('m1', true).listItems('m1', 'emp', 'caissier', 'org1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('their own station works, and the owner reaches every station', async () => {
    await expect(build('m1').listItems('m1', 'emp', 'gerant', 'org1')).resolves.toEqual([]);
    await expect(build(null).listItems('m1', 'boss', 'enterprise', undefined)).resolves.toEqual([]);
  });
});

describe('the stock password is an option the owner switches on (off by default)', () => {
  it('off: no password is asked — the role alone decides', async () => {
    const { service, stockPasswords } = setup({ required: false });
    await expect(service.assertManagementPassword('m1', 'emp', 'magasinier', 'org1', undefined)).resolves.toBeUndefined();
    await expect(service.assertManagementPassword('m1', 'boss', 'enterprise', undefined, undefined)).resolves.toBeUndefined();
    expect(stockPasswords.verifyPassword).not.toHaveBeenCalled();
  });

  it('off: someone without the role is still refused', async () => {
    await expect(setup({ required: false }).service.assertManagementPassword('m1', 'stranger', 'client', undefined, undefined))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('on: the password is asked again', async () => {
    const err: any = await setup({ required: true }).service.assertManagementPassword('m1', 'boss', 'enterprise', undefined, undefined).catch((e) => e);
    expect(err.getResponse().code).toBe('STOCK_PASSWORD_REQUIRED');
  });
});
