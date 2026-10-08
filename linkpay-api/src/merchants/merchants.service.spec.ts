import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MerchantsService } from './merchants.service';
import { createFakeSupabase, has, RecordedQuery } from '../test-utils/fake-supabase';

const MERCHANT = 'merchant-1';
const OWNER = 'owner-1';
const ROLE_IDS: Record<string, string> = { cashier: 'role-cashier', client: 'role-client', merchant: 'role-merchant' };

function setup(opts: { targetRoles?: string[]; existingMembership?: boolean; removedRows?: number; demotedRows?: number } = {}) {
  const fake = createFakeSupabase((q: RecordedQuery) => {
    const slugCall = q.calls.find((c) => c.method === 'eq' && c.args[0] === 'slug');
    if (q.target === 'roles' && slugCall) return { data: { id: ROLE_IDS[slugCall.args[1]] } };
    if (q.target === 'profiles') return { data: { id: 'target-1' } };
    if (q.target === 'user_roles' && has(q, 'select', 'role:roles(slug)')) {
      return { data: (opts.targetRoles ?? ['client']).map((slug) => ({ role: { slug } })) };
    }
    if (q.target === 'merchant_users' && has(q, 'limit', 1)) {
      return { data: opts.existingMembership ? [{ id: 'mu-x' }] : [] };
    }
    if (q.target === 'merchant_users' && has(q, 'delete')) {
      return { data: Array.from({ length: opts.removedRows ?? 1 }, (_, i) => ({ id: `mu-${i}` })) };
    }
    if (q.target === 'user_roles' && has(q, 'delete') && has(q, 'select', 'id')) {
      return { data: Array.from({ length: opts.demotedRows ?? 1 }, (_, i) => ({ id: `ur-${i}` })) };
    }
    if (q.target === 'merchant_users' && has(q, 'insert')) return { data: { id: 'mu-new' } };
    return { data: null };
  });
  const service = new MerchantsService(fake.service, {} as any);
  const userRoleWrites = () =>
    fake.queries.filter((q) => q.target === 'user_roles' && (has(q, 'insert') || (has(q, 'delete') && !has(q, 'select', 'id'))));
  return { service, fake, userRoleWrites };
}

describe('MerchantsService.addMerchantUser', () => {
  it.each(['super_admin', 'admin', 'merchant', 'enterprise', 'cashier'])(
    'refuses to invite a user whose role is %s, without touching their role',
    async (role) => {
      const { service, userRoleWrites } = setup({ targetRoles: [role] });
      await expect(service.addMerchantUser(MERCHANT, OWNER, { email: 'x@y.cd' })).rejects.toBeInstanceOf(BadRequestException);
      expect(userRoleWrites()).toHaveLength(0);
    },
  );

  it('refuses someone already on a store team', async () => {
    const { service, userRoleWrites } = setup({ existingMembership: true });
    await expect(service.addMerchantUser(MERCHANT, OWNER, { email: 'x@y.cd' })).rejects.toBeInstanceOf(BadRequestException);
    expect(userRoleWrites()).toHaveLength(0);
  });

  it('refuses inviting oneself', async () => {
    const fake = createFakeSupabase((q) => (q.target === 'profiles' ? { data: { id: OWNER } } : { data: null }));
    const service = new MerchantsService(fake.service, {} as any);
    await expect(service.addMerchantUser(MERCHANT, OWNER, { email: 'me@y.cd' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('invites a plain client and makes them cashier of this store', async () => {
    const { service, fake } = setup({ targetRoles: ['client'] });
    await service.addMerchantUser(MERCHANT, OWNER, { email: 'x@y.cd' });
    const insert = fake.queries.find((q) => q.target === 'user_roles' && has(q, 'insert'));
    expect(insert?.calls.find((c) => c.method === 'insert')?.args[0]).toEqual({
      user_id: 'target-1',
      role_id: ROLE_IDS.cashier,
      merchant_id: MERCHANT,
    });
  });
});

describe('MerchantsService.removeMerchantUser', () => {
  it('refuses removing the owner', async () => {
    const { service, userRoleWrites } = setup();
    await expect(service.removeMerchantUser(MERCHANT, OWNER, OWNER)).rejects.toBeInstanceOf(BadRequestException);
    expect(userRoleWrites()).toHaveLength(0);
  });

  it('does not touch the role of someone who is not a cashier of this store (e.g. an admin)', async () => {
    const { service, userRoleWrites } = setup({ removedRows: 0 });
    await expect(service.removeMerchantUser(MERCHANT, OWNER, 'admin-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(userRoleWrites()).toHaveLength(0);
  });

  it('only deletes a cashier membership row of this store', async () => {
    const { service, fake } = setup();
    await service.removeMerchantUser(MERCHANT, OWNER, 'cashier-1');
    const del = fake.queries.find((q) => q.target === 'merchant_users' && has(q, 'delete'))!;
    expect(has(del, 'eq', 'merchant_id', MERCHANT)).toBe(true);
    expect(has(del, 'eq', 'role_id', ROLE_IDS.cashier)).toBe(true);
  });

  it('returns a removed cashier to client', async () => {
    const { service, fake } = setup();
    await service.removeMerchantUser(MERCHANT, OWNER, 'cashier-1');
    const insert = fake.queries.find((q) => q.target === 'user_roles' && has(q, 'insert'));
    expect(insert?.calls.find((c) => c.method === 'insert')?.args[0]).toEqual({ user_id: 'cashier-1', role_id: ROLE_IDS.client });
  });

  it('leaves the global role alone if it no longer points at this store', async () => {
    const { service, fake } = setup({ demotedRows: 0 });
    await service.removeMerchantUser(MERCHANT, OWNER, 'cashier-1');
    expect(fake.queries.some((q) => q.target === 'user_roles' && has(q, 'insert'))).toBe(false);
  });
});
