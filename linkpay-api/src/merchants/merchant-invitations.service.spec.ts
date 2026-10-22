import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MerchantInvitationsService } from './merchant-invitations.service';
import { createFakeSupabase, has, RecordedQuery } from '../test-utils/fake-supabase';

const MERCHANT = 'shop-1';
const OWNER = 'owner-1';
const TARGET = { id: 'target-1', full_name: 'Grace Mbuyi Kasongo', phone: '+243812345678' };

function setup(opts: { roles?: string[]; member?: boolean; claimWins?: boolean; profile?: any } = {}) {
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'profiles' && has(q, 'like')) return { data: opts.profile === null ? [] : [opts.profile ?? TARGET] };
    if (q.target === 'profiles') return { data: opts.profile === null ? null : opts.profile ?? TARGET };
    if (q.target === 'user_roles' && has(q, 'select', 'role:roles(slug)')) return { data: (opts.roles ?? ['client']).map((slug) => ({ role: { slug } })) };
    if (q.target === 'merchant_users' && has(q, 'limit', 1)) return { data: opts.member ? [{ id: 'mu' }] : [] };
    if (q.target === 'merchant_invitations' && has(q, 'insert')) return { data: { id: 'inv-1', status: 'pending', expires_at: '2026-10-29' } };
    if (q.target === 'merchant_invitations' && has(q, 'update') && has(q, 'eq', 'user_id', TARGET.id)) {
      return { data: opts.claimWins === false ? null : { id: 'inv-1', merchant_id: MERCHANT, invited_by: OWNER } };
    }
    if (q.target === 'merchants') return { data: { name: 'Boutique Mukendi', owner_id: OWNER } };
    if (q.target === 'roles') return { data: { id: 'role-cashier' } };
    return { data: null };
  });
  const notifications = { create: jest.fn(async () => undefined) };
  const auth = { generateToken: jest.fn(async () => 'new-token') };
  const service = new MerchantInvitationsService(fake.service, auth as any, notifications as any);
  const roleWrites = () => fake.queries.filter((q) => q.target === 'user_roles' && (has(q, 'insert') || has(q, 'delete')));
  return { service, fake, notifications, auth, roleWrites };
}

describe('Inviting a cashier: nothing changes on their account until they accept', () => {
  it('finds the person by phone, whatever the format typed, and only sends an invitation', async () => {
    const { service, fake, notifications, roleWrites } = setup();
    const inv = await service.invite(MERCHANT, OWNER, { phone: '081 234 5678' });
    expect(inv).toMatchObject({ id: 'inv-1', invitee: { name: 'Grace K.', phone: '•••• 345 678' } });
    expect(fake.queries.some((q) => q.target === 'profiles' && has(q, 'like'))).toBe(true);
    expect(roleWrites()).toHaveLength(0);
    expect(fake.queries.some((q) => q.target === 'merchant_users' && has(q, 'insert'))).toBe(false);
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ user_id: TARGET.id, type: 'merchant_invitation' }));
  });

  it('still works by email', async () => {
    const { service, fake } = setup();
    await service.invite(MERCHANT, OWNER, { email: 'grace@exemple.cd' });
    expect(fake.queries.some((q) => q.target === 'profiles' && has(q, 'ilike', 'email', 'grace@exemple.cd'))).toBe(true);
  });

  it('a number that is not a DRC number is refused clearly', async () => {
    await expect(setup().service.invite(MERCHANT, OWNER, { phone: '12' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('nobody with this number: the person must create an account first', async () => {
    await expect(setup({ profile: null }).service.invite(MERCHANT, OWNER, { phone: '0812345678' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each(['merchant', 'cashier', 'enterprise', 'admin', 'super_admin'])('refuses an account that is %s', async (role) => {
    const { service, fake } = setup({ roles: [role] });
    await expect(service.invite(MERCHANT, OWNER, { phone: '0812345678' })).rejects.toBeInstanceOf(BadRequestException);
    expect(fake.queries.some((q) => q.target === 'merchant_invitations' && has(q, 'insert'))).toBe(false);
  });

  it('refuses someone already in a team, and oneself', async () => {
    await expect(setup({ member: true }).service.invite(MERCHANT, OWNER, { phone: '0812345678' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup({ profile: { ...TARGET, id: OWNER } }).service.invite(MERCHANT, OWNER, { phone: '0812345678' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('The invited person answers', () => {
  it('accepts: joins the team as cashier, role replaced, new token so the app switches at once', async () => {
    const { service, fake, auth, notifications } = setup();
    const r = await service.accept(TARGET.id, 'grace@exemple.cd', 'sess-1', 'inv-1');
    expect(r).toMatchObject({ status: 'accepted', merchant_id: MERCHANT, access_token: 'new-token' });
    expect(fake.queries.find((q) => q.target === 'merchant_users' && has(q, 'insert'))!.calls[0].args[0]).toMatchObject({ merchant_id: MERCHANT, user_id: TARGET.id });
    expect(has(fake.queries.find((q) => q.target === 'user_roles' && has(q, 'insert'))!, 'insert', { user_id: TARGET.id, role_id: 'role-cashier', merchant_id: MERCHANT })).toBe(true);
    expect(auth.generateToken).toHaveBeenCalledWith(TARGET.id, 'grace@exemple.cd', 'cashier', MERCHANT, 'sess-1');
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ user_id: OWNER, type: 'merchant_invitation_accepted' }));
  });

  it('an invitation cancelled, expired, answered or of someone else changes nothing', async () => {
    const { service, roleWrites } = setup({ claimWins: false });
    await expect(service.accept(TARGET.id, 'g@x.cd', undefined, 'inv-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(roleWrites()).toHaveLength(0);
  });

  it('their account became a merchant meanwhile: refused, the invitation waits again', async () => {
    const { service, fake, roleWrites } = setup({ roles: ['merchant'] });
    await expect(service.accept(TARGET.id, 'g@x.cd', undefined, 'inv-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(roleWrites()).toHaveLength(0);
    expect(fake.queries.some((q) => q.target === 'merchant_invitations' && has(q, 'update', { status: 'pending', responded_at: null }))).toBe(true);
  });

  it('declines: nothing changes on their account, the owner is told', async () => {
    const { service, roleWrites, notifications } = setup();
    expect(await service.decline(TARGET.id, 'inv-1')).toEqual({ status: 'declined' });
    expect(roleWrites()).toHaveLength(0);
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ user_id: OWNER, type: 'merchant_invitation_declined' }));
  });
});
