import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

function setup(opts: { existing?: any[]; supplierOfOrg?: boolean } = {}) {
  const inserts: any[] = [];
  const fake = createFakeSupabase((q: RecordedQuery) => {
    const m = (name: string) => q.calls.find((c) => c.method === name);
    if (q.target === 'suppliers') {
      if (m('insert')) {
        inserts.push(m('insert')!.args[0]);
        return { data: { id: 's-new', ...m('insert')!.args[0] } };
      }
      if (m('ilike')) return { data: opts.existing ?? [] };
      if (m('maybeSingle')) return { data: opts.supplierOfOrg === false ? null : { id: 's1' } };
      return { data: opts.existing ?? [] };
    }
    if (q.target === 'stock_items') return { data: [] };
    return { data: null };
  });
  const orgs = { getOrganizationById: jest.fn(async () => ({ id: 'org1', owner_id: 'boss' })) };
  return { service: new SuppliersService(fake.service, orgs as any), inserts };
}

const boss = { id: 'boss', role: 'enterprise' };

describe('suppliers (all sectors)', () => {
  it('the owner, a manager and a stock keeper add suppliers; a seller or a cashier cannot', async () => {
    const { service, inserts } = setup();
    await service.create('org1', boss, { name: '  Bralima   Goma ' });
    expect(inserts[0]).toEqual(expect.objectContaining({ organization_id: 'org1', name: 'Bralima Goma' }));
    await service.create('org1', { id: 'g', role: 'gerant', organization_id: 'org1' }, { name: 'X' });
    await service.create('org1', { id: 'k', role: 'magasinier', organization_id: 'org1' }, { name: 'Y' });
    for (const role of ['vendeur', 'caissier', 'comptable']) {
      await expect(service.create('org1', { id: 'v', role, organization_id: 'org1' }, { name: 'Z' })).rejects.toBeInstanceOf(ForbiddenException);
    }
    // Staff of another enterprise
    await expect(service.create('org1', { id: 'g2', role: 'gerant', organization_id: 'org2' }, { name: 'Z' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the accountant may read the list', async () => {
    await expect(setup().service.list('org1', { id: 'c', role: 'comptable', organization_id: 'org1' })).resolves.toEqual([]);
  });

  it('typing a name already on the list gives back that supplier, never a second one', async () => {
    const { service, inserts } = setup({ existing: [{ id: 's1', name: 'Bralima' }] });
    const s = await service.create('org1', boss, { name: 'bralima' });
    expect(s.id).toBe('s1');
    expect(inserts).toHaveLength(0);
  });

  it('a product sheet: a typed name is added, a picked id must belong to the enterprise, null clears', async () => {
    const typed = setup();
    await expect(typed.service.resolveForProduct('org1', 'boss', { supplier_name: 'Nouveau' })).resolves.toBe('s-new');
    await expect(setup().service.resolveForProduct('org1', 'boss', { supplier_id: 's1' })).resolves.toBe('s1');
    await expect(setup({ supplierOfOrg: false }).service.resolveForProduct('org1', 'boss', { supplier_id: 'foreign' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup().service.resolveForProduct('org1', 'boss', { supplier_id: null })).resolves.toBeNull();
    await expect(setup().service.resolveForProduct('org1', 'boss', { supplier_name: '  ' })).resolves.toBeNull();
    await expect(setup().service.resolveForProduct('org1', 'boss', {})).resolves.toBeUndefined();
  });

  it('a name with a wildcard is a new supplier, never another one ("Bra*" is not "Bralima")', async () => {
    const { service, inserts } = setup({ existing: [{ id: 's1', name: 'Bralima' }] });
    const s = await service.create('org1', boss, { name: 'Bra*' });
    expect(s.id).toBe('s-new');
    expect(inserts[0].name).toBe('Bra*');
  });

  it('an empty name is refused', async () => {
    await expect(setup().service.create('org1', boss, { name: '   ' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
