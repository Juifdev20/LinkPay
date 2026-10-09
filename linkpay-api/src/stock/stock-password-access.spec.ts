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
