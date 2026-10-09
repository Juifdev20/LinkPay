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
