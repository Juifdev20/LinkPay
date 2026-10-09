import { ForbiddenException } from '@nestjs/common';
import { assertStockPasswordAccess } from './stock.controller';

const org = { id: 'org1', owner_id: 'boss' };

describe('who may handle the shared stock password', () => {
  it('only the patron (or an admin) may define or change it', () => {
    expect(() => assertStockPasswordAccess(org, { id: 'boss', role: 'enterprise' }, 'owner')).not.toThrow();
    expect(() => assertStockPasswordAccess(org, { id: 'a', role: 'super_admin' }, 'owner')).not.toThrow();
    for (const role of ['magasinier', 'vendeur', 'caissier', 'comptable']) {
      expect(() => assertStockPasswordAccess(org, { id: 'emp', role, organizationId: 'org1' }, 'owner')).toThrow(/Seul le patron/);
    }
  });
  it("the organization's own staff may check it (to confirm an edit), nobody else", () => {
    expect(() => assertStockPasswordAccess(org, { id: 'emp', role: 'magasinier', organizationId: 'org1' }, 'member')).not.toThrow();
    expect(() => assertStockPasswordAccess(org, { id: 'other', role: 'magasinier', organizationId: 'org2' }, 'member')).toThrow(ForbiddenException);
    expect(() => assertStockPasswordAccess(org, { id: 'client', role: 'client' }, 'member')).toThrow(ForbiddenException);
  });
});

describe('assertStockPasswordAccess — "manager" level (trying the password counts toward the company\'s lockout)', () => {
  const org = { id: 'o1', owner_id: 'boss' };
  const as = (role: string, organizationId = 'o1', id = 'u1') => () => assertStockPasswordAccess(org, { id, role, organizationId }, 'manager');

  it('the owner, the stock keeper of this company and administrators may try it', () => {
    expect(as('enterprise', 'o1', 'boss')).not.toThrow();
    expect(as('magasinier')).not.toThrow();
    expect(as('super_admin', 'x')).not.toThrow();
  });

  it('a seller, a cashier or an accountant may not (they could lock the stock keeper out by guessing)', () => {
    for (const role of ['vendeur', 'caissier', 'comptable']) expect(as(role)).toThrow();
  });

  it('a stock keeper of ANOTHER company may not', () => {
    expect(as('magasinier', 'other-org')).toThrow();
  });
});
