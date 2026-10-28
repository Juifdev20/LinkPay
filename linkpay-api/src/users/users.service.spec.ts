import { UsersService, toPublicProfile } from './users.service';
import { createFakeSupabase } from '../test-utils/fake-supabase';

const ROW = {
  id: 'u1', email: 'a@x.cd', full_name: 'Jean', phone: '+243900000000', status: 'active', must_change_password: false, two_factor_enabled: true,
  transaction_pin_hash: '$2b$10$abcdefghijklmnopqrstuv', pin_attempts: 2, pin_locked_until: null,
  two_factor_secret: 'JBSWY3DPEHPK3PXP', active_session_id: 'sess', active_device_id: 'dev',
};
const PRIVATE = ['transaction_pin_hash', 'pin_attempts', 'pin_locked_until', 'two_factor_secret', 'active_session_id', 'active_device_id'];

describe('profile responses never carry secrets', () => {
  it('toPublicProfile drops the PIN hash, 2FA secret and session/lockout columns but keeps the rest', () => {
    const out = toPublicProfile(ROW);
    for (const k of PRIVATE) expect(out).not.toHaveProperty(k);
    expect(out).toMatchObject({ id: 'u1', email: 'a@x.cd', full_name: 'Jean', two_factor_enabled: true, must_change_password: false });
  });

  it('GET /users/me (getProfile) strips them and still adds the role', async () => {
    const fake = createFakeSupabase(() => ({ data: ROW }));
    const profile: any = await new UsersService(fake.service).getProfile('u1', 'merchant', 'm1');
    for (const k of PRIVATE) expect(profile).not.toHaveProperty(k);
    expect(profile).toMatchObject({ role: 'merchant', merchant_id: 'm1', email: 'a@x.cd' });
  });

  it('updateProfile returns the updated profile without them', async () => {
    const fake = createFakeSupabase(() => ({ data: ROW }));
    const updated: any = await new UsersService(fake.service).updateProfile('u1', { full_name: 'Jean' });
    for (const k of PRIVATE) expect(updated).not.toHaveProperty(k);
  });
});

describe('the face shown in the app (photo or company logo)', () => {
  const PHOTO = 'https://x.supabase.co/storage/v1/object/public/avatars/users/u1/aaaa.webp';
  const LOGO = 'https://x.supabase.co/storage/v1/object/public/avatars/orgs/o1/bbbb.webp';
  const world = (logo: string | null) => createFakeSupabase((q) => (q.target === 'organizations' ? { data: { logo_url: logo } } : { data: { ...ROW, avatar_url: PHOTO } }));

  it('a client or a merchant shows their own photo', async () => {
    for (const role of ['client', 'merchant']) {
      const p: any = await new UsersService(world(LOGO).service).getProfile('u1', role);
      expect(p).toMatchObject({ avatar_url: PHOTO, avatar_kind: 'photo' });
    }
  });

  it("the owner of a company shows the company's logo, not a personal photo", async () => {
    const p: any = await new UsersService(world(LOGO).service).getProfile('u1', 'enterprise');
    expect(p).toMatchObject({ avatar_url: LOGO, avatar_kind: 'logo' });
  });

  it('a staff member (cashier, gérant…) and an owner acting as a store show the company logo too', async () => {
    const staff: any = await new UsersService(world(LOGO).service).getProfile('u1', 'caissier', 'm1', undefined, 'o1');
    expect(staff).toMatchObject({ avatar_url: LOGO, avatar_kind: 'logo' });
    const acting: any = await new UsersService(world(LOGO).service).getProfile('u1', 'merchant', 'm1', 'o1');
    expect(acting).toMatchObject({ avatar_url: LOGO, avatar_kind: 'logo' });
  });

  it('a company without a logo yet shows none (the silhouette), never the personal photo', async () => {
    const p: any = await new UsersService(world(null).service).getProfile('u1', 'enterprise');
    expect(p).toMatchObject({ avatar_url: null, avatar_kind: 'logo' });
  });

  it('the profile update ignores an address typed by the caller: a photo only comes through the upload', async () => {
    const fake = createFakeSupabase(() => ({ data: ROW }));
    await new UsersService(fake.service).updateProfile('u1', { full_name: 'Jean', avatar_url: 'https://evil.example/track.png' });
    const update = fake.queries.find((q) => q.calls.some((c) => c.method === 'update'))!;
    expect(JSON.stringify(update.calls.find((c) => c.method === 'update')!.args[0])).not.toContain('evil.example');
  });
});
