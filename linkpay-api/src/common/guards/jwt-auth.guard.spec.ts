import { ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JwtAuthGuard } from './jwt-auth.guard';

function run(user: any, opts: { ips?: string; ip?: string; allow?: boolean; isPublic?: boolean } = {}) {
  const reflector = {
    getAllAndOverride: (key: string) => (key === 'isPublic' ? !!opts.isPublic : key === 'allowWithoutMfa' ? !!opts.allow : undefined),
  } as any;
  const config = { get: (k: string) => (k === 'ADMIN_ALLOWED_IPS' ? opts.ips : undefined) } as any;
  const guard = new JwtAuthGuard(reflector, config);
  // The passport strategy itself is not under test: pretend it authenticated `user`.
  jest.spyOn(AuthGuard('jwt').prototype, 'canActivate').mockResolvedValue(true as any);
  const req: any = { user, ip: opts.ip };
  return guard.canActivate({ getHandler: () => 'h', getClass: () => 'c', switchToHttp: () => ({ getRequest: () => req }) } as any);
}

describe('JwtAuthGuard — administrator protection', () => {
  afterEach(() => jest.restoreAllMocks());

  it('lets a regular user through without any second factor', async () => {
    await expect(run({ id: 'u', role: 'client' })).resolves.toBe(true);
  });

  it('blocks an admin session that has not passed the authenticator check', async () => {
    await expect(run({ id: 'a', role: 'super_admin', mfa: false })).rejects.toMatchObject({ response: { code: 'MFA_REQUIRED' } });
    await expect(run({ id: 'a', role: 'admin' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets a verified admin through, and an unverified one reach the endpoints marked for setup', async () => {
    await expect(run({ id: 'a', role: 'admin', mfa: true })).resolves.toBe(true);
    await expect(run({ id: 'a', role: 'admin', mfa: false }, { allow: true })).resolves.toBe(true);
  });

  it('enforces the optional admin network list', async () => {
    await expect(run({ id: 'a', role: 'admin', mfa: true }, { ips: '1.1.1.1', ip: '2.2.2.2' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(run({ id: 'a', role: 'admin', mfa: true }, { ips: '1.1.1.1', ip: '1.1.1.1' })).resolves.toBe(true);
  });
});
