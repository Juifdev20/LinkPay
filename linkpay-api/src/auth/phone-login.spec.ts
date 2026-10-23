import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthApiError } from '@supabase/supabase-js';
import * as bcrypt from 'bcryptjs';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';
import { AuthService } from './auth.service';
import { PhoneAccountService } from './phone-account.service';
import { normalizeDrcPhone, technicalEmailFor, generateRecoveryCode, canonicalRecoveryCode, isTechnicalEmail } from './phone';

const SECRET = 's'.repeat(48);
const jwt = new JwtService({ secret: SECRET, signOptions: { expiresIn: '15m' } });
const config = { get: (k: string, d?: any) => ({ JWT_SECRET: SECRET, JWT_EXPIRES_IN: '15m', JWT_REFRESH_EXPIRES_IN: '365d' } as any)[k] ?? d };

describe('DRC phone numbers', () => {
  it('accepts what people type and stores one form', () => {
    for (const input of ['0812345678', '812345678', '243812345678', '+243812345678', '+243 812 345 678', '00243812345678', '081 234 56 78']) {
      expect(normalizeDrcPhone(input)).toBe('+243812345678');
    }
  });
  it('refuses what is not a DRC mobile number', () => {
    for (const input of ['', '12345', '+33612345678', '0012345678', '+2438123456789', 'abc']) {
      expect(normalizeDrcPhone(input)).toBeNull();
    }
  });
  it('a phone-only account gets a technical, never-delivered email', () => {
    expect(technicalEmailFor('+243812345678')).toBe('t243812345678@sans-email.scanlinkpay.invalid');
    expect(isTechnicalEmail(technicalEmailFor('+243812345678'))).toBe(true);
  });
  it('recovery codes are readable and typed loosely', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(code).not.toMatch(/[01OIL]/);
    expect(canonicalRecoveryCode(code.toLowerCase().replace(/-/g, ' '))).toBe(code.replace(/-/g, ''));
  });
});

/** A small world: profiles (by phone), Supabase Auth users (by email), and what got written. */
function setup(opts: { profiles?: { id: string; phone: string; email?: string | null; recovery_code_hash?: string | null }[]; authUsers?: Record<string, { email: string; password: string }> } = {}) {
  const profiles = opts.profiles ?? [];
  const authUsers = opts.authUsers ?? {};
  const writes: { table: string; op: string; payload: any }[] = [];
  const fake = createFakeSupabase((q: RecordedQuery) => {
    const m = (name: string) => q.calls.find((c) => c.method === name);
    if (q.target === 'profiles') {
      for (const op of ['upsert', 'update']) if (m(op)) writes.push({ table: 'profiles', op, payload: m(op)!.args[0] });
      if (m('like')) return { data: profiles.map((p) => ({ id: p.id, phone: p.phone })) };
      if (m('select') && String(m('select')!.args[0]).includes('recovery_code_hash')) {
        const id = m('eq')?.args[1];
        return { data: profiles.find((p) => p.id === id) || null };
      }
      return { data: { id: profiles[0]?.id, email: profiles[0]?.email ?? null, phone: profiles[0]?.phone, must_change_password: false } };
    }
    if (q.target === 'roles') return { data: { id: 'role-client' } };
    if (q.target === 'user_roles') return { data: { role: { slug: 'client' }, merchant_id: null, organization_id: null } };
    return { data: null };
  });
  const client = fake.service.getClient();
  const createUser = jest.fn(async (args: any) => ({ data: { user: { id: 'new-user', email: args.email } }, error: null }));
  const updateUserById = jest.fn(async () => ({ error: null }));
  client.auth = { admin: { createUser, updateUserById, getUserById: async (id: string) => ({ data: { user: authUsers[id] ? { id, email: authUsers[id].email } : null } }) } };
  const signIn = jest.fn(async ({ email, password }: any) => {
    const hit = Object.entries(authUsers).find(([, u]) => u.email === email && u.password === password);
    return hit
      ? { data: { user: { id: hit[0] }, session: { access_token: 'sb-a', refresh_token: 'sb-r' } }, error: null }
      : { data: { user: null, session: null }, error: new AuthApiError('Invalid login credentials', 400, 'x') };
  });
  const supabase = { getClient: () => client, getAuthClient: () => ({ auth: { signInWithPassword: signIn } }) } as any;
  const attempts = { reserve: jest.fn(async () => ({ justLocked: false })), release: jest.fn(async () => undefined), recordSuccess: jest.fn(async () => undefined) };
  const notifications = { create: jest.fn(async () => undefined) };
  const phoneAccounts = new PhoneAccountService(supabase);
  const service = new AuthService(supabase, jwt, config as any, notifications as any, attempts as any, {} as any, { alert: jest.fn() } as any, phoneAccounts);
  return { service, writes, createUser, updateUserById, signIn, attempts };
}

describe('sign-up with the phone number, email optional', () => {
  it('phone only: technical email in Auth, no email on the profile, a recovery code handed back once', async () => {
    const { service, createUser, writes } = setup();
    const res = await service.register({ phone: '0812345678', password: 'Secret123' } as any);
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ email: 't243812345678@sans-email.scanlinkpay.invalid', phone: '+243812345678' }));
    expect(writes.find((w) => w.op === 'upsert')!.payload).toMatchObject({ email: null, phone: '+243812345678' });
    expect(res.user.email).toBeNull();
    expect(res.recovery_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    // stored hashed, never as typed
    const stored = writes.find((w) => w.op === 'update' && w.payload.recovery_code_hash)!.payload.recovery_code_hash;
    expect(stored).not.toContain(res.recovery_code!);
  });

  it('with an email, that email is the account’s', async () => {
    const { service, createUser } = setup();
    await service.register({ phone: '+243 990 000 001', email: 'Jean@Mail.com', password: 'Secret123' } as any);
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'jean@mail.com', phone: '+243990000001' }));
  });

  it('refuses a number already used, or one that is not a DRC number', async () => {
    await expect(setup({ profiles: [{ id: 'u1', phone: '+243 812 345 678' }] }).service.register({ phone: '0812345678', password: 'Secret123' } as any))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(setup().service.register({ phone: '12345', password: 'Secret123' } as any)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('logging in with the phone number', () => {
  const world = { profiles: [{ id: 'u1', phone: '+243 812 345 678', email: null }], authUsers: { u1: { email: 't243812345678@sans-email.scanlinkpay.invalid', password: 'Secret123' } } };

  it('the number (typed any way) finds the account, even one stored in an older format', async () => {
    const { service, signIn } = setup(world);
    const res = await service.login({ phone: '0812345678', password: 'Secret123' } as any);
    expect(signIn).toHaveBeenCalledWith({ email: 't243812345678@sans-email.scanlinkpay.invalid', password: 'Secret123' });
    expect(res.user.email).toBeNull();
  });

  it('a wrong password and an unknown number get the same answer', async () => {
    await expect(setup(world).service.login({ phone: '0812345678', password: 'nope' } as any)).rejects.toThrow('Numéro ou mot de passe incorrect');
    await expect(setup(world).service.login({ phone: '0999999999', password: 'Secret123' } as any)).rejects.toThrow('Numéro ou mot de passe incorrect');
  });

  it('older accounts still log in with their email', async () => {
    const { service } = setup({ profiles: [{ id: 'u2', phone: '+243990000002', email: 'old@mail.com' }], authUsers: { u2: { email: 'old@mail.com', password: 'Secret123' } } });
    await expect(service.login({ email: 'old@mail.com', password: 'Secret123' } as any)).resolves.toMatchObject({ user: { id: 'u2' } });
  });
});

describe('forgotten password with the recovery code', () => {
  const withCode = async () => setup({
    profiles: [{ id: 'u1', phone: '+243812345678', email: null, recovery_code_hash: await bcrypt.hash('K7PM3QX9T2WA', 4) }],
    authUsers: { u1: { email: 't243812345678@sans-email.scanlinkpay.invalid', password: 'old' } },
  });

  it('the right code sets the new password, ends the sessions, and gives a NEW code', async () => {
    const { service, updateUserById, writes } = await withCode();
    const res = await service.recoverWithCode({ phone: '0812345678', recovery_code: 'k7pm 3qx9 t2wa', new_password: 'NewSecret1' });
    expect(updateUserById).toHaveBeenCalledWith('u1', { password: 'NewSecret1' });
    expect(writes).toContainEqual(expect.objectContaining({ op: 'update', payload: expect.objectContaining({ active_session_id: null }) }));
    expect(res.recovery_code).not.toBe('K7PM-3QX9-T2WA');
  });

  it('a wrong code or an unknown number: the same refusal, the password untouched', async () => {
    const { service, updateUserById } = await withCode();
    await expect(service.recoverWithCode({ phone: '0812345678', recovery_code: 'AAAA-BBBB-CCCC', new_password: 'NewSecret1' })).rejects.toThrow('Numéro ou code de secours incorrect.');
    await expect(service.recoverWithCode({ phone: '0999999999', recovery_code: 'K7PM-3QX9-T2WA', new_password: 'NewSecret1' })).rejects.toThrow('Numéro ou code de secours incorrect.');
    expect(updateUserById).not.toHaveBeenCalled();
  });
});

describe('the phone number cannot be typed in wrong', () => {
  it('a login with a malformed number is refused like a wrong password', async () => {
    await expect(setup().service.login({ phone: 'abc', password: 'x' } as any)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
