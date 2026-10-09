import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { StockService } from './stock.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

function setup(opts: { verify?: () => Promise<void> } = {}) {
  const fake = createFakeSupabase((q: RecordedQuery) =>
    q.target === 'merchants' ? { data: { id: 'm1', owner_id: 'boss', organization_id: 'org1' } } : { data: null });
  const stockPasswords = { verifyPassword: jest.fn(opts.verify ?? (async () => undefined)) };
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
      if (q.target === 'stock_items' && q.calls.some((c) => c.method === 'maybeSingle')) return { data: { name: 'Samsung A15', quantity: 12, unit_price_cents: 90000 } };
      if (q.target === 'stock_items' && q.calls.some((c) => c.method === 'single')) return { data: { name: 'Samsung A15', quantity: 12, unit_price_cents: 90000 } };
      return { data: null };
    });
    const audit = { log: jest.fn(async () => undefined) };
    const passwords = { verifyPassword: jest.fn(async () => undefined) };
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
