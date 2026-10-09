import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';
import { LoginAttemptsService } from '../auth/login-attempts.service';
import { TwoFactorService, hashRecoveryCode } from './two-factor.service';
import { SecurityAlertsService } from './security-alerts.service';
import { SecurityMonitorService } from './security-monitor.service';
import { OtpStepUpGuard, REQUIRE_OTP_KEY } from './otp-step-up.guard';
import { isAdminIpAllowed } from './admin-ip';
import { codeForStep, generateSecret, stepAt } from './totp';

const config = { get: (k: string) => (k === 'JWT_SECRET' ? 'x'.repeat(40) : undefined) } as any;

function twoFactorSetup(profile: any, opts: { stepFree?: boolean; recoveryOk?: boolean } = {}) {
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'profiles') return { data: profile };
    if (q.target === 'rpc:claim_totp_step') return { data: opts.stepFree !== false };
    if (q.target === 'rpc:consume_recovery_code') return { data: opts.recoveryOk === true };
    return { data: null };
  });
  const attempts = new LoginAttemptsService();
  const service = new TwoFactorService(fake.service, attempts, config);
  return { service, attempts, fake };
}

describe('TwoFactorService', () => {
  it('encrypts the secret at rest and reads it back', () => {
    const { service } = twoFactorSetup(null);
    const secret = generateSecret();
    const stored = service.encryptSecret(secret);
    expect(stored).not.toContain(secret);
    expect(service.decryptSecret(stored)).toBe(secret);
    expect(() => service.decryptSecret(stored.slice(0, -4) + 'AAAA')).toThrow();
  });

  it('accepts a correct current code once, rejects a code whose step was already used', async () => {
    const secret = generateSecret();
    const { service } = twoFactorSetup({ two_factor_enabled: true, two_factor_secret: new TwoFactorService({ getClient: () => ({}) } as any, new LoginAttemptsService(), config).encryptSecret(secret) });
    const code = codeForStep(secret, stepAt(Date.now()));
    expect(await service.verify('u1', code)).toBe(true);
    const replay = twoFactorSetup(
      { two_factor_enabled: true, two_factor_secret: service.encryptSecret(secret) },
      { stepFree: false },
    );
    expect(await replay.service.verify('u1', code)).toBe(false);
  });

  it('rejects a wrong code and locks the account after repeated failures', async () => {
    const secret = generateSecret();
    const enc = new TwoFactorService({ getClient: () => ({}) } as any, new LoginAttemptsService(), config).encryptSecret(secret);
    const { service } = twoFactorSetup({ two_factor_enabled: true, two_factor_secret: enc });
    for (let i = 0; i < 5; i++) expect(await service.verify('u1', '000000')).toBe(false);
    await expect(service.verify('u1', codeForStep(secret, stepAt(Date.now())))).rejects.toMatchObject({ status: 429 });
  });

  it('accepts a recovery code only when the database consumes it', async () => {
    const enc = new TwoFactorService({ getClient: () => ({}) } as any, new LoginAttemptsService(), config).encryptSecret(generateSecret());
    const ok = twoFactorSetup({ two_factor_enabled: true, two_factor_secret: enc }, { recoveryOk: true });
    expect(await ok.service.verify('u1', 'ABCDE-12345')).toBe(true);
    const used = twoFactorSetup({ two_factor_enabled: true, two_factor_secret: enc }, { recoveryOk: false });
    expect(await used.service.verify('u1', 'ABCDE-12345')).toBe(false);
    expect(hashRecoveryCode('abcde-12345')).toBe(hashRecoveryCode('ABCDE12345'));
  });

  it('never validates when 2FA is not enabled', async () => {
    const { service } = twoFactorSetup({ two_factor_enabled: false, two_factor_secret: null });
    expect(await service.verify('u1', '123456')).toBe(false);
  });
});

describe('OtpStepUpGuard', () => {
  const ctx = (user: any, headers: any = {}) => ({
    getHandler: () => 'h', getClass: () => 'c',
    switchToHttp: () => ({ getRequest: () => ({ user, headers }) }),
  }) as any;
  const reflector = (required: boolean) => ({ getAllAndOverride: (k: string) => (k === REQUIRE_OTP_KEY ? required : undefined) }) as unknown as Reflector;
  const twoFactor = (valid: boolean) => ({ assertValid: jest.fn(async () => { if (!valid) throw new ForbiddenException(); }) }) as any;

  it('leaves unmarked endpoints alone', async () => {
    expect(await new OtpStepUpGuard(reflector(false), twoFactor(false)).canActivate(ctx({ id: 'a' }))).toBe(true);
  });

  it('asks for a code when none is sent and the session is not fresh', async () => {
    const guard = new OtpStepUpGuard(reflector(true), twoFactor(true));
    await expect(guard.canActivate(ctx({ id: 'a', mfa: true, mfa_at: Math.floor(Date.now() / 1000) - 3600 }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('accepts a session that proved its second factor minutes ago, without asking again', async () => {
    const tf = twoFactor(true);
    const guard = new OtpStepUpGuard(reflector(true), tf);
    expect(await guard.canActivate(ctx({ id: 'a', mfa: true, mfa_at: Math.floor(Date.now() / 1000) - 60 }))).toBe(true);
    expect(tf.assertValid).not.toHaveBeenCalled();
  });

  it('checks the code from the header otherwise, and refuses a wrong one', async () => {
    const stale = { id: 'a', mfa: true, mfa_at: 1 };
    expect(await new OtpStepUpGuard(reflector(true), twoFactor(true)).canActivate(ctx(stale, { 'x-otp-code': '123456' }))).toBe(true);
    await expect(new OtpStepUpGuard(reflector(true), twoFactor(false)).canActivate(ctx(stale, { 'x-otp-code': '000000' }))).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('SecurityAlertsService', () => {
  function setup() {
    const fake = createFakeSupabase((q: RecordedQuery) => {
      if (q.target === 'roles') return { data: [{ id: 'r1' }] };
      if (q.target === 'user_roles') return { data: [{ user_id: 'a1' }, { user_id: 'a2' }, { user_id: 'a1' }] };
      return { data: null };
    });
    const notifications = { create: jest.fn(async () => undefined) };
    return { service: new SecurityAlertsService(fake.service, notifications as any), notifications };
  }

  it('notifies each admin once, with a severity marker', async () => {
    const { service, notifications } = setup();
    await service.alert({ severity: 'critical', title: 'Test', body: 'b' });
    expect(notifications.create).toHaveBeenCalledTimes(2);
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'security_alert', title: expect.stringContaining('Test') }));
  });

  it('sends the same alert only once in the dedupe window, and can skip a user', async () => {
    const { service, notifications } = setup();
    await service.alert({ severity: 'warning', title: 'T', body: 'b', dedupeKey: 'k' });
    await service.alert({ severity: 'warning', title: 'T', body: 'b', dedupeKey: 'k' });
    expect(notifications.create).toHaveBeenCalledTimes(2);
    await service.alert({ severity: 'info', title: 'T2', body: 'b', excludeUserId: 'a1' });
    expect(notifications.create).toHaveBeenCalledTimes(3);
  });

  it('never throws, even when the channel is broken', async () => {
    const { service, notifications } = setup();
    notifications.create.mockRejectedValue(new Error('push down'));
    await expect(service.alert({ severity: 'info', title: 'T', body: 'b' })).resolves.toBeUndefined();
  });
});

describe('SecurityMonitorService', () => {
  it('raises a critical alert when a wallet is below zero, and stays quiet otherwise', async () => {
    const alert = jest.fn(async () => undefined);
    const run = async (rows: any[]) => {
      const fake = createFakeSupabase((q) => (q.target === 'rpc:negative_wallet_balances' ? { data: rows } : { data: null }));
      return new SecurityMonitorService(fake.service, { alert } as any).checkLedgerIntegrity();
    };
    expect(await run([])).toBe(0);
    expect(alert).not.toHaveBeenCalled();
    expect(await run([{ wallet_id: 'w1', currency: 'CDF', balance_cents: -500 }])).toBe(1);
    expect(alert).toHaveBeenCalledWith(expect.objectContaining({ severity: 'critical' }));
  });
});

describe('isAdminIpAllowed', () => {
  it('allows everything when no list is configured, otherwise only listed addresses', () => {
    expect(isAdminIpAllowed(undefined, '1.2.3.4')).toBe(true);
    expect(isAdminIpAllowed('', undefined)).toBe(true);
    expect(isAdminIpAllowed('1.2.3.4, 5.6.7.8', '5.6.7.8')).toBe(true);
    expect(isAdminIpAllowed('1.2.3.4', '::ffff:1.2.3.4')).toBe(true);
    expect(isAdminIpAllowed('1.2.3.4', '9.9.9.9')).toBe(false);
    expect(isAdminIpAllowed('1.2.3.4', undefined)).toBe(false);
  });
});
