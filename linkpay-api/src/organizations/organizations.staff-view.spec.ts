import { toStaffOrganization } from './organizations.service';

describe('what staff see of their organization', () => {
  const org = {
    id: 'org1', name: 'ABC', sector: 'supermarche', currency: 'CDF', status: 'active', scanlinkpay_number: 'SLP-000001',
    payout_info: { bank: 'Rawbank', account: '0001' }, legal_representative: { name: 'Patron' },
    legal_identifiers: { rccm: 'X', nif: 'Y' }, tax_regime: 'reel', owner_id: 'boss', stock_password_hash: 'h',
  };

  it('keeps what their screens need', () => {
    expect(toStaffOrganization(org)).toMatchObject({ id: 'org1', name: 'ABC', sector: 'supermarche', currency: 'CDF', scanlinkpay_number: 'SLP-000001' });
  });

  it("never the payout account, legal representative, identifiers, tax regime or the owner's id", () => {
    const view = toStaffOrganization(org) as Record<string, unknown>;
    for (const field of ['payout_info', 'legal_representative', 'legal_identifiers', 'tax_regime', 'owner_id', 'stock_password_hash']) {
      expect(view).not.toHaveProperty(field);
    }
  });
});
