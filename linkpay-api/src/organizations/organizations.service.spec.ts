import { toPublicOrganization } from './organizations.service';

describe('toPublicOrganization', () => {
  it('drops the stock password hash and its counters but keeps the rest', () => {
    const out = toPublicOrganization({
      id: 'o1', name: 'Super Marché', status: 'active', scanlinkpay_number: 'SLP-000001',
      stock_password_hash: '$2b$10$hash', stock_password_attempts: 2, stock_password_locked_until: null,
    });
    expect(out).toEqual({ id: 'o1', name: 'Super Marché', status: 'active', scanlinkpay_number: 'SLP-000001' });
  });
});
