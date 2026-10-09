import { BadRequestException, ForbiddenException, HttpException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthApiError } from '@supabase/supabase-js';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';
import { AuthService } from './auth.service';
import { LoginAttemptsService } from './login-attempts.service';
import { WalletPinService } from '../wallets/wallet-pin.service';

const SECRET = 's'.repeat(48);
const jwt = new JwtService({ secret: SECRET, signOptions: { expiresIn: '15m' } });
const config = { get: (k: string, d?: any) => ({ JWT_SECRET: SECRET, JWT_EXPIRES_IN: '15m', JWT_REFRESH_EXPIRES_IN: '365d', ADMIN_REFRESH_EXPIRES_IN: '12h' } as any)[k] ?? d };

function makeAuth(opts: {
  signIn?: () => Promise<any>;
  role?: string;
  profile?: any;
  twoFactorEnabled?: boolean;
  reservation?: { justLocked: boolean };
  tokensValidAfter?: string | null;
  recordedUpdates?: any[];
} = {}) {
  const updates = opts.recordedUpdates ?? [];
  const fake = createFakeSupabase((q: RecordedQuery) => {
    const upd = q.calls.find((c) => c.method === 'update');
    if (upd) updates.push({ table: q.target, patch: upd.args[0] });
    if (q.target === 'user_roles') return { data: { role: { slug: opts.role ?? 'client' }, merchant_id: null, organization_id: null } };
    if (q.target === 'profiles') {
      const cols = q.calls.find((c) => c.method === 'select')?.args[0];
      if (cols === 'tokens_valid_after') return { data: { tokens_valid_after: opts.tokensValidAfter ?? null } };
      return { data: { id: 'u1', email: 'a@x.com', active_session_id: null, must_change_password: false, ...(opts.profile || {}) } };
    }
    return { data: null };
  });
  const signIn = jest.fn(opts.signIn ?? (async () => ({ data: { user: { id: 'u1' }, session: { access_token: 'sb-a', refresh_token: 'sb-r' } }, error: null })));
  const supabase = { getClient: fake.service.getClient, getAuthClient: () => ({ auth: { signInWithPassword: signIn } }) } as any;
  const attempts = {
    reserve: jest.fn(async () => opts.reservation ?? { justLocked: false }),
    release: jest.fn(async () => undefined),
    recordSuccess: jest.fn(async () => undefined),
  };
  const alerts = { alert: jest.fn(async () => undefined) };
  const twoFactor = { isEnabled: jest.fn(async () => !!opts.twoFactorEnabled), verify: jest.fn(async () => true) };
  const service = new AuthService(supabase, jwt, config as any, { create: jest.fn() } as any, attempts as any, twoFactor as any, alerts as any);
  return { service, attempts, alerts, twoFactor, updates, signIn };
}

const authError = (status: number, message = 'Invalid login credentials') => new AuthApiError(message, status, 'x');
const rejecting = (status: number, message?: string) => async () => ({ data: { user: null, session: null }, error: authError(status, message) });

describe('login: attempts are counted BEFORE the password is tried', () => {
  it('reserves first, then tries the password; a wrong password is a 401 and alerts only when it is the attempt that locked', async () => {
    const order: string[] = [];
    const a = makeAuth({ signIn: async () => { order.push('signIn'); return rejecting(400)(); }, reservation: { justLocked: true } });
    a.attempts.reserve.mockImplementation(async () => { order.push('reserve'); return { justLocked: true }; });
    await expect(a.service.login({ email: 'a@x.com', password: 'bad' } as any, { ip: '1.2.3.4' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(order).toEqual(['reserve', 'signIn']);
    expect(a.alerts.alert).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('verrouillé') }));

    const b = makeAuth({ signIn: rejecting(400), reservation: { justLocked: false } });
    await expect(b.service.login({ email: 'a@x.com', password: 'bad' } as any)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(b.alerts.alert).not.toHaveBeenCalled();
  });

  it('a locked account is refused before the password is even tried', async () => {
    const a = makeAuth();
    a.attempts.reserve.mockRejectedValue(new HttpException('Trop de tentatives', 429));
    await expect(a.service.login({ email: 'a@x.com', password: 'whatever' } as any)).rejects.toMatchObject({ status: 429 });
    expect(a.signIn).not.toHaveBeenCalled();
  });

  it('the auth provider rate-limiting us (429) is not a wrong password: the attempt is given back and the user is told to retry', async () => {
    const a = makeAuth({ signIn: rejecting(429, 'rate limit') });
    await expect(a.service.login({ email: 'a@x.com', password: 'good' } as any)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(a.attempts.release).toHaveBeenCalledWith('a@x.com');
    expect(a.alerts.alert).not.toHaveBeenCalled();
  });

  it('a removed employee is told so, and the attempt is given back', async () => {
    const a = makeAuth({ signIn: rejecting(400, 'User is banned') });
    await expect(a.service.login({ email: 'a@x.com', password: 'good' } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(a.attempts.release).toHaveBeenCalled();
  });

  it('success clears the counter', async () => {
    const a = makeAuth();
    const res: any = await a.service.login({ email: 'a@x.com', password: 'good' } as any);
    expect(a.attempts.recordSuccess).toHaveBeenCalledWith('a@x.com');
    expect(res.supabase_session).toEqual({ access_token: 'sb-a', refresh_token: 'sb-r' });
  });
});

describe('login: the Supabase session of an administrator who has not passed the second factor', () => {
  it('is withheld (it would already satisfy the database admin rules); a verified admin and ordinary users get it', async () => {
    const noMfa = makeAuth({ role: 'admin', twoFactorEnabled: false });
    expect(((await noMfa.service.login({ email: 'a@x.com', password: 'p' } as any)) as any).supabase_session).toBeNull();

    const withMfa = makeAuth({ role: 'admin', twoFactorEnabled: true });
    expect(((await withMfa.service.login({ email: 'a@x.com', password: 'p', otp: '123456' } as any)) as any).supabase_session).not.toBeNull();

    const client = makeAuth({ role: 'client' });
    expect(((await client.service.login({ email: 'a@x.com', password: 'p' } as any)) as any).supabase_session).not.toBeNull();
  });
});

describe('administrator refresh tokens', () => {
  const refreshToken = (extra: any = {}) => jwt.sign({ sub: 'u1', email: 'a@x.com', type: 'refresh', mfa: true, mfa_at: Math.floor(Date.now() / 1000), ...extra }, { expiresIn: '12h' });
  const now = () => Math.floor(Date.now() / 1000);

  it('a normal refresh works and keeps the original sign-in time (the session cannot be extended for ever)', async () => {
    const a = makeAuth({ role: 'admin' });
    const out = await a.service.refresh(refreshToken({ auth_at: now() - 3600 }));
    const next: any = jwt.decode(out.refresh_token);
    expect(next.auth_at).toBe(now() - 3600);
    expect(next.mfa).toBe(true);
  });

  it('is refused once the session is older than the absolute limit, however often it was refreshed', async () => {
    const a = makeAuth({ role: 'admin' });
    await expect(a.service.refresh(refreshToken({ auth_at: now() - 25 * 3600 }))).rejects.toThrow(/expired/);
  });

  it('is refused when the account was logged out / reset after the token was issued, but works for a token issued afterwards', async () => {
    const revoked = new Date((now() - 60) * 1000).toISOString();
    const stale = makeAuth({ role: 'admin', tokensValidAfter: revoked });
    await expect(stale.service.refresh(refreshToken({ iat: now() - 600, auth_at: now() - 600 }))).rejects.toThrow(/revoked/);
    const fresh = makeAuth({ role: 'admin', tokensValidAfter: revoked });
    await expect(fresh.service.refresh(refreshToken({ iat: now(), auth_at: now() }))).resolves.toBeDefined();
  });

  it('ordinary users are not subject to the administrator age limit', async () => {
    const a = makeAuth({ role: 'client', profile: { active_session_id: 's1' } });
    await expect(a.service.refresh(jwt.sign({ sub: 'u1', email: 'a@x.com', type: 'refresh', session_id: 's1', auth_at: now() - 90 * 86400 }, { expiresIn: '365d' }))).resolves.toBeDefined();
  });

  it('logout revokes the account\'s tokens', async () => {
    const a = makeAuth();
    await a.service.logout('u1');
    expect(a.updates.some((u) => u.table === 'profiles' && 'tokens_valid_after' in u.patch)).toBe(true);
  });
});

describe('changePassword', () => {
  it('needs the current password (a stolen session token alone must not take the account over)', async () => {
    const a = makeAuth({ profile: { must_change_password: false } });
    await expect(a.service.changePassword('u1', 'new-password-123')).rejects.toBeInstanceOf(BadRequestException);
    expect(a.signIn).not.toHaveBeenCalled();
  });

  it('a wrong current password is refused (and counts toward a lockout)', async () => {
    const a = makeAuth({ profile: { must_change_password: false }, signIn: rejecting(400) });
    await expect(a.service.changePassword('u1', 'new-password-123', 'wrong')).rejects.toBeInstanceOf(ForbiddenException);
    expect(a.attempts.reserve).toHaveBeenCalledWith('chpw:u1');
  });

  it('the forced first-login change does not ask for it (the temporary password was just typed)', async () => {
    const a = makeAuth({ profile: { must_change_password: true } });
    (a.service as any).supabaseService.getClient().auth = { admin: { updateUserById: async () => ({ error: null }) } };
    expect(a.signIn).not.toHaveBeenCalled();
    // the first guard (current password) is skipped: it proceeds to the update, which this minimal fake can't complete
    await a.service.changePassword('u1', 'new-password-123').catch(() => undefined);
    expect(a.attempts.reserve).not.toHaveBeenCalled();
  });
});

describe('LoginAttemptsService.reserve', () => {
  const make = (rows: any[]) => {
    let i = 0;
    const fake = createFakeSupabase((q) => (q.target === 'rpc:reserve_auth_attempt' ? { data: [rows[Math.min(i++, rows.length - 1)]] } : { data: null }));
    return new LoginAttemptsService(fake.service);
  };

  it('lets the first attempts through, flags the one that locks, and refuses what follows with 429', async () => {
    const s = make([
      { allowed: true, locked_until: null, just_locked: false },
      { allowed: true, locked_until: new Date(Date.now() + 900_000).toISOString(), just_locked: true },
      { allowed: false, locked_until: new Date(Date.now() + 800_000).toISOString(), just_locked: false },
    ]);
    expect(await s.reserve('a@x.com')).toEqual({ justLocked: false });
    expect(await s.reserve('a@x.com')).toEqual({ justLocked: true });
    await expect(s.reserve('a@x.com')).rejects.toMatchObject({ status: 429 });
  });

  it('without the database function it falls back to the same rule in memory', async () => {
    const fake = createFakeSupabase((q) => (q.target.startsWith('rpc:') ? { error: { message: 'function does not exist' } } : { data: null }));
    const s = new LoginAttemptsService(fake.service);
    const t = 1_000_000;
    const results = [];
    for (let i = 0; i < 5; i++) results.push((await s.reserve('x@y.com', t + i)).justLocked);
    expect(results).toEqual([false, false, false, false, true]);
    await expect(s.reserve('x@y.com', t + 10)).rejects.toMatchObject({ status: 429 });
    await expect(s.reserve('other@y.com', t + 10)).resolves.toBeDefined();
  });
});

describe('WalletPinService.verifyPin', () => {
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('1234', 4);
  const make = (reserve: any, opts: { reserveError?: boolean } = {}) => {
    const calls: string[] = [];
    const fake = createFakeSupabase((q) => {
      if (q.target === 'rpc:reserve_pin_attempt') { calls.push('reserve'); return opts.reserveError ? { error: { message: 'function does not exist' } } : { data: [reserve] }; }
      if (q.target === 'rpc:clear_pin_attempts') { calls.push('clear'); return { data: null }; }
      if (q.target === 'profiles') return { data: { transaction_pin_hash: hash, pin_attempts: 0, pin_locked_until: null } };
      return { data: null };
    });
    return { service: new WalletPinService(fake.service), calls };
  };

  it('a right PIN passes and clears the counter', async () => {
    const m = make({ has_pin: true, allowed: true, attempts: 1, just_locked: false });
    await expect(m.service.verifyPin('u1', '1234')).resolves.toBeUndefined();
    expect(m.calls).toEqual(['reserve', 'clear']);
  });

  it('a wrong PIN says how many tries are left; the try that reaches the limit says the account is locked', async () => {
    await expect(make({ has_pin: true, allowed: true, attempts: 2, just_locked: false }).service.verifyPin('u1', '0000')).rejects.toThrow(/3 tentative/);
    await expect(make({ has_pin: true, allowed: true, attempts: 5, just_locked: true }).service.verifyPin('u1', '0000')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a request that arrives while locked is refused WITHOUT comparing (so parallel guesses cannot all be tested), even with the right PIN', async () => {
    const m = make({ has_pin: true, allowed: false, locked_until: new Date(Date.now() + 600_000).toISOString(), attempts: 0, just_locked: false });
    await expect(m.service.verifyPin('u1', '1234')).rejects.toBeInstanceOf(ForbiddenException);
    expect(m.calls).toEqual(['reserve']);
  });

  it('no PIN set → clear message; migration 055 missing → the previous behaviour still works', async () => {
    await expect(make({ has_pin: false, allowed: false }).service.verifyPin('u1', '1234')).rejects.toBeInstanceOf(BadRequestException);
    await expect(make(null, { reserveError: true }).service.verifyPin('u1', '1234')).resolves.toBeUndefined();
  });
});
