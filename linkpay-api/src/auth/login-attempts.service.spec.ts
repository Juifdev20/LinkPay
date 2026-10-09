import { HttpException } from '@nestjs/common';
import { LOGIN_LOCK_MS, LOGIN_WINDOW_MS, LoginAttemptsService, MAX_FAILED_LOGINS } from './login-attempts.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

const fail = async (s: LoginAttemptsService, email: string, n: number, t = 0) => { for (let i = 0; i < n; i++) await s.recordFailure(email, t); };

describe('LoginAttemptsService (in-memory fallback)', () => {
  it('locks an account after too many failures, whatever the email casing', async () => {
    const s = new LoginAttemptsService();
    await fail(s, 'Alice@x.com', MAX_FAILED_LOGINS, 1000);
    await expect(s.assertNotLocked('alice@x.com', 2000)).rejects.toBeInstanceOf(HttpException);
  });

  it('does not lock below the limit, and a success clears the count', async () => {
    const s = new LoginAttemptsService();
    await fail(s, 'a@x.com', MAX_FAILED_LOGINS - 1, 1000);
    await expect(s.assertNotLocked('a@x.com', 1500)).resolves.toBeUndefined();
    await s.recordSuccess('a@x.com');
    await fail(s, 'a@x.com', MAX_FAILED_LOGINS - 1, 2000);
    await expect(s.assertNotLocked('a@x.com', 2500)).resolves.toBeUndefined();
  });

  it('the lock expires by itself', async () => {
    const s = new LoginAttemptsService();
    await fail(s, 'a@x.com', MAX_FAILED_LOGINS, 1000);
    await expect(s.assertNotLocked('a@x.com', 1000 + LOGIN_LOCK_MS + 1)).resolves.toBeUndefined();
  });

  it('failures older than the window do not add up', async () => {
    const s = new LoginAttemptsService();
    await fail(s, 'a@x.com', MAX_FAILED_LOGINS - 1, 0);
    await s.recordFailure('a@x.com', LOGIN_WINDOW_MS + 10);
    await expect(s.assertNotLocked('a@x.com', LOGIN_WINDOW_MS + 20)).resolves.toBeUndefined();
  });

  it('accounts are independent, and the failure that locks says so', async () => {
    const s = new LoginAttemptsService();
    await fail(s, 'a@x.com', MAX_FAILED_LOGINS - 1, 1000);
    expect(await s.recordFailure('a@x.com', 1000)).toBe(true);
    await expect(s.assertNotLocked('b@x.com', 1500)).resolves.toBeUndefined();
  });
});

describe('LoginAttemptsService (shared database counters)', () => {
  function setup(opts: { lockUntil?: string | null; justLocked?: boolean; rpcError?: string } = {}) {
    const fake = createFakeSupabase((q: RecordedQuery) => {
      if (opts.rpcError) return { data: null, error: { message: opts.rpcError } };
      if (q.target === 'rpc:get_auth_lock') return { data: opts.lockUntil ?? null };
      if (q.target === 'rpc:record_auth_failure') return { data: [{ locked_until: opts.lockUntil ?? null, just_locked: !!opts.justLocked }] };
      return { data: null };
    });
    return { service: new LoginAttemptsService(fake.service), fake };
  }
  const rpcArgs = (fake: any, name: string) => fake.queries.find((q: RecordedQuery) => q.target === `rpc:${name}`)?.calls[0].args[0];

  it('refuses while the database says the account is locked', async () => {
    const { service } = setup({ lockUntil: new Date(Date.now() + 5 * 60_000).toISOString() });
    await expect(service.assertNotLocked('a@x.com')).rejects.toMatchObject({ status: 429 });
  });

  it('lets the account through when the database has no lock', async () => {
    const { service } = setup({ lockUntil: null });
    await expect(service.assertNotLocked('a@x.com')).resolves.toBeUndefined();
  });

  it('stores only a hash of the account, never the email', async () => {
    const { service, fake } = setup();
    await service.recordFailure('Alice@X.com');
    const key = rpcArgs(fake, 'record_auth_failure').p_key;
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rpcArgs(fake, 'record_auth_failure'))).not.toContain('alice');
  });

  it('reports the failure that triggers the lock', async () => {
    expect(await setup({ justLocked: true }).service.recordFailure('a@x.com')).toBe(true);
    expect(await setup({ justLocked: false }).service.recordFailure('a@x.com')).toBe(false);
  });

  it('keeps protecting from memory when the database part is unavailable (migration not applied)', async () => {
    const { service } = setup({ rpcError: 'function record_auth_failure does not exist' });
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) await service.recordFailure('a@x.com');
    await expect(service.assertNotLocked('a@x.com')).rejects.toMatchObject({ status: 429 });
  });
});
