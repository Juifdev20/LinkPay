import { ForbiddenException } from '@nestjs/common';
import { assertMerchantCanReceive } from './merchant-status';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

const client = (merchant: any, org?: any) =>
  createFakeSupabase((q: RecordedQuery) => (q.target === 'merchants' ? { data: merchant } : q.target === 'organizations' ? { data: org ?? null } : { data: null })).service.getClient();

describe('assertMerchantCanReceive (the admin "suspend" now does something)', () => {
  it.each(['suspended', 'rejected', 'closed'])('refuses a %s merchant', async (status) => {
    await expect(assertMerchantCanReceive(client({ status, organization_id: null }), 'm1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a store of a suspended or closed business, even if the store itself is active', async () => {
    for (const orgStatus of ['suspended', 'closed']) {
      await expect(assertMerchantCanReceive(client({ status: 'active', organization_id: 'o1' }, { status: orgStatus }), 'm1')).rejects.toMatchObject({ response: { code: 'MERCHANT_SUSPENDED' } });
    }
  });

  it('lets active merchants and stores of active (or still pending) businesses through, and ignores an unknown id', async () => {
    await expect(assertMerchantCanReceive(client({ status: 'active', organization_id: null }), 'm1')).resolves.toBeUndefined();
    await expect(assertMerchantCanReceive(client({ status: 'active', organization_id: 'o1' }, { status: 'active' }), 'm1')).resolves.toBeUndefined();
    await expect(assertMerchantCanReceive(client({ status: 'active', organization_id: 'o1' }, { status: 'pending' }), 'm1')).resolves.toBeUndefined();
    await expect(assertMerchantCanReceive(client(null), 'ghost')).resolves.toBeUndefined();
    await expect(assertMerchantCanReceive(client(null), undefined)).resolves.toBeUndefined();
  });
});
