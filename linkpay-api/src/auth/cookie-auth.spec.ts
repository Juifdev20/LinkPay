import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import * as express from 'express';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthCookiesService, parseCookies } from './auth-cookies';
import { CookieAuthInterceptor } from './cookie-auth.interceptor';
import { createCsrfMiddleware } from './csrf.middleware';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SupabaseService } from '../supabase/supabase.service';
import { TwoFactorService } from '../security/two-factor.service';
import { SecurityAlertsService } from '../security/security-alerts.service';

const SECRET = 'x'.repeat(48);
const WEB = 'https://app.scanlinkpay.com';
const revokedAt: { value: string | null } = { value: null };
const HDR = { 'x-auth-mode': 'cookie', 'x-requested-with': 'ScanLinkPay', origin: WEB };

async function bootApp(env: Record<string, string> = {}) {
  Object.assign(process.env, { JWT_SECRET: SECRET, COOKIE_AUTH: 'true', NODE_ENV: 'production', ...env });
  const authService = {
    login: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(async () => undefined),
    exitActingAs: jest.fn(),
  };
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), PassportModule, JwtModule.register({ secret: SECRET, signOptions: { expiresIn: '15m' } })],
    controllers: [AuthController],
    providers: [
      JwtStrategy,
      AuthCookiesService,
      { provide: AuthService, useValue: authService },
      { provide: SupabaseService, useValue: { getClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { active_session_id: 's1' } }), maybeSingle: async () => ({ data: { tokens_valid_after: revokedAt.value } }) }) }) }) }) } },
      { provide: TwoFactorService, useValue: { isEnabled: async () => false } },
      { provide: SecurityAlertsService, useValue: { alert: jest.fn() } },
      { provide: APP_GUARD, useFactory: (r: Reflector, c: any) => new JwtAuthGuard(r, c), inject: [Reflector, 'ConfigService'] },
      { provide: APP_INTERCEPTOR, useClass: CookieAuthInterceptor },
      { provide: 'ConfigService', useExisting: require('@nestjs/config').ConfigService },
    ],
  }).compile();
  const app = moduleRef.createNestApplication({ bodyParser: false });
  app.use(express.json());
  app.use(createCsrfMiddleware([WEB, /^https?:\/\/localhost(:\d+)?$/]));
  app.setGlobalPrefix('api/v1');
  await app.init();
  const jwt = moduleRef.get(JwtService);
  return { app, authService, jwt, token: (extra: any = {}, exp = '15m') => jwt.sign({ sub: 'u1', email: 'a@x.com', role: 'client', ...extra }, { expiresIn: exp as any }) };
}

const setCookies = (res: request.Response): string[] => ([] as string[]).concat((res.headers['set-cookie'] as any) || []);
const cookieNamed = (res: request.Response, name: string) => setCookies(res).find((c) => c.startsWith(`${name}=`));

describe('cookie sessions', () => {
  let ctx: Awaited<ReturnType<typeof bootApp>>;
  let app: INestApplication;
  beforeEach(async () => { ctx = await bootApp(); app = ctx.app; });
  afterEach(async () => { await app.close(); });

  const loginBody = () => ({ user: { id: 'u1' }, access_token: ctx.token(), refresh_token: ctx.token({ type: 'refresh' }, '365d'), supabase_session: { access_token: 'sb-a', refresh_token: 'sb-r' } });

  it('login in cookie mode: tokens go into HttpOnly cookies and never into the body (nor the Supabase session)', async () => {
    ctx.authService.login.mockResolvedValue(loginBody());
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').set(HDR).send({ email: 'a@x.com', password: 'secret-pass' }).expect(200);
    expect(res.body).toEqual({ user: { id: 'u1' }, session_in_cookie: true });
    const at = cookieNamed(res, 'lp_at')!, rt = cookieNamed(res, 'lp_rt')!;
    expect(at).toMatch(/HttpOnly/i); expect(at).toMatch(/Secure/i); expect(at).toMatch(/SameSite=Strict/i); expect(at).toMatch(/Path=\/api\/v1(;|$)/);
    expect(rt).toMatch(/HttpOnly/i); expect(rt).toMatch(/Path=\/api\/v1\/auth(;|$)/);
    // the lifetime follows the token: ~15 min for access, ~1 year for refresh
    expect(Number(/Max-Age=(\d+)/i.exec(at)![1])).toBeLessThanOrEqual(900);
    expect(Number(/Max-Age=(\d+)/i.exec(rt)![1])).toBeGreaterThan(300 * 86400);
  });

  it('"remember me" off: session cookies (no Max-Age) that die with the browser', async () => {
    ctx.authService.login.mockResolvedValue(loginBody());
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').set({ ...HDR, 'x-auth-remember': '0' }).send({ email: 'a@x.com', password: 'secret-pass' });
    expect(cookieNamed(res, 'lp_at')).not.toMatch(/Max-Age|Expires/i);
    expect(cookieNamed(res, 'lp_rt')).not.toMatch(/Max-Age|Expires/i);
  });

  it('other clients (no header) still get tokens in the body and no cookie', async () => {
    ctx.authService.login.mockResolvedValue(loginBody());
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'a@x.com', password: 'secret-pass' }).expect(200);
    expect(res.body.access_token).toBeDefined();
    expect(res.body.supabase_session).toBeDefined();
    expect(setCookies(res)).toHaveLength(0);
  });

  it('when COOKIE_AUTH is off the header changes nothing', async () => {
    await app.close();
    ({ app, authService: ctx.authService } = await bootApp({ COOKIE_AUTH: 'false' }));
    ctx.authService.login.mockResolvedValue(loginBody());
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').set(HDR).send({ email: 'a@x.com', password: 'secret-pass' });
    expect(res.body.access_token).toBeDefined();
    expect(setCookies(res)).toHaveLength(0);
  });

  it('an authenticated request works with the cookie alone', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/auth/2fa/status').set('x-auth-mode', 'cookie').set('Cookie', `lp_at=${ctx.token()}`).expect(200);
    expect(res.body).toMatchObject({ enabled: false });
    await request(app.getHttpServer()).get('/api/v1/auth/2fa/status').expect(401);
    await request(app.getHttpServer()).get('/api/v1/auth/2fa/status').set('x-auth-mode', 'cookie').set('Cookie', 'lp_at=garbage').expect(401);
  });

  it('a cookie is NOT an identity unless the browser announced cookie mode (so a script cannot get a cookie-authenticated request answered with tokens)', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/2fa/status').set('Cookie', `lp_at=${ctx.token()}`).expect(401);
  });

  it('CSRF: a state-changing request with only the cookie is refused without our header, from a foreign origin, or when flagged cross-site', async () => {
    const cookie = `lp_at=${ctx.token()}`;
    const post = () => request(app.getHttpServer()).post('/api/v1/auth/logout').set('x-auth-mode', 'cookie').set('Cookie', cookie);
    expect((await post().expect(403)).body.code).toBe('CSRF_REJECTED');
    await post().set('x-requested-with', 'ScanLinkPay').set('origin', 'https://evil.example').expect(403);
    await post().set('x-requested-with', 'ScanLinkPay').set('origin', 'null').expect(403);
    await post().set('x-requested-with', 'ScanLinkPay').set('sec-fetch-site', 'cross-site').expect(403);
    expect(ctx.authService.logout).not.toHaveBeenCalled();
    await post().set('x-requested-with', 'ScanLinkPay').set('origin', WEB).set('sec-fetch-site', 'same-origin').expect(200);
    expect(ctx.authService.logout).toHaveBeenCalledWith('u1');
  });

  it('CSRF: reading is never blocked, and bearer clients are not affected', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/2fa/status').set('x-auth-mode', 'cookie').set('Cookie', `lp_at=${ctx.token()}`).expect(200);
    await request(app.getHttpServer()).post('/api/v1/auth/logout').set('Authorization', `Bearer ${ctx.token()}`).expect(200);
  });

  it('CSRF: a junk Authorization header is not a way around the checks (only a real Bearer token exempts a request)', async () => {
    const cookie = `lp_at=${ctx.token()}`;
    await request(app.getHttpServer()).post('/api/v1/auth/logout').set('Authorization', 'Basic xxx').set('Cookie', cookie).set('x-auth-mode', 'cookie').expect(403);
    await request(app.getHttpServer()).post('/api/v1/auth/logout').set('Authorization', 'garbage').set('Cookie', cookie).expect(403);
  });

  it('a refresh token is not an access token (cookie or Bearer), whatever its lifetime', async () => {
    const refresh = ctx.token({ type: 'refresh' }, '365d');
    await request(app.getHttpServer()).get('/api/v1/auth/2fa/status').set('Authorization', `Bearer ${refresh}`).expect(401);
    await request(app.getHttpServer()).get('/api/v1/auth/2fa/status').set('x-auth-mode', 'cookie').set('Cookie', `lp_at=${refresh}`).expect(401);
  });

  it('logout clears both cookies', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/logout').set(HDR).set('Cookie', `lp_at=${ctx.token()}`).expect(200);
    expect(cookieNamed(res, 'lp_at')).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(cookieNamed(res, 'lp_rt')).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('refresh reads the refresh cookie, rotates both cookies, and returns no token', async () => {
    const old = ctx.token({ type: 'refresh' }, '365d');
    ctx.authService.refresh.mockResolvedValue({ access_token: ctx.token(), refresh_token: ctx.token({ type: 'refresh' }, '365d') });
    const res = await request(app.getHttpServer()).post('/api/v1/auth/refresh').set(HDR).set('Cookie', `lp_rt=${old}`).send({}).expect(200);
    expect(ctx.authService.refresh).toHaveBeenCalledWith(old);
    expect(res.body).toEqual({ session_in_cookie: true });
    expect(cookieNamed(res, 'lp_at')).toBeDefined();
    expect(cookieNamed(res, 'lp_rt')).toBeDefined();
  });

  it('a dead refresh cookie is rejected and wiped', async () => {
    ctx.authService.refresh.mockRejectedValue(new UnauthorizedException('Invalid or expired refresh token'));
    const res = await request(app.getHttpServer()).post('/api/v1/auth/refresh').set(HDR).set('Cookie', 'lp_rt=old').send({}).expect(401);
    expect(cookieNamed(res, 'lp_rt')).toMatch(/Expires=Thu, 01 Jan 1970/);
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({}).expect(401); // no token anywhere
  });

  it('a body refresh_token still works for non-browser clients, and the cookie is ignored outside cookie mode', async () => {
    ctx.authService.refresh.mockResolvedValue({ access_token: 'a', refresh_token: 'r' });
    const res = await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refresh_token: 'from-body' }).expect(200);
    expect(ctx.authService.refresh).toHaveBeenCalledWith('from-body');
    expect(res.body).toEqual({ access_token: 'a', refresh_token: 'r' });
    ctx.authService.refresh.mockClear();
    // A cookie on a request that did not announce cookie mode is not a refresh token (and a cookie without our CSRF header is refused outright).
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', 'lp_rt=sneaky').send({}).expect(403);
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('x-requested-with', 'ScanLinkPay').set('Cookie', 'lp_rt=sneaky').send({}).expect(401);
    expect(ctx.authService.refresh).not.toHaveBeenCalled();
  });

  it('exit-store re-derives the owner session, only from inside a store, and sets cookies', async () => {
    ctx.authService.exitActingAs.mockResolvedValue({ access_token: ctx.token({ role: 'enterprise' }), refresh_token: ctx.token({ type: 'refresh' }, '365d') });
    const outside = ctx.token();
    await request(app.getHttpServer()).post('/api/v1/auth/exit-store').set(HDR).set('Cookie', `lp_at=${outside}`).expect(400);
    const inside = ctx.token({ role: 'merchant', merchant_id: 'm1', acting_as_org_id: 'o1', session_id: 's1' });
    const res = await request(app.getHttpServer()).post('/api/v1/auth/exit-store').set(HDR).set('Cookie', `lp_at=${inside}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ session_in_cookie: true });
    expect(ctx.authService.exitActingAs).toHaveBeenCalledWith('u1', 'a@x.com', 's1');
  });

  it('session/clear works without a session and wipes the cookies', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/session/clear').set(HDR).set('Cookie', 'lp_rt=whatever').expect(200);
    expect(cookieNamed(res, 'lp_rt')).toMatch(/Expires=Thu, 01 Jan 1970/);
  });
});

describe('administrator token revocation', () => {
  it('a token issued before the revocation moment is refused for an admin, a later one works, and ordinary users are not affected', async () => {
    const { app, token } = await bootApp();
    try {
      const admin = (iat?: number) => token({ role: 'admin', mfa: true, mfa_at: Math.floor(Date.now() / 1000), ...(iat ? { iat } : {}) });
      const now = Math.floor(Date.now() / 1000);
      revokedAt.value = null;
      await request(app.getHttpServer()).get('/api/v1/auth/2fa/status').set('Authorization', `Bearer ${admin(now - 600)}`).expect(200);
      revokedAt.value = new Date((now - 60) * 1000).toISOString();
      await request(app.getHttpServer()).get('/api/v1/auth/2fa/status').set('Authorization', `Bearer ${admin(now - 600)}`).expect(401); // stolen before the logout
      await request(app.getHttpServer()).get('/api/v1/auth/2fa/status').set('Authorization', `Bearer ${admin(now)}`).expect(200); // signed in again after
      await request(app.getHttpServer()).get('/api/v1/auth/2fa/status').set('Authorization', `Bearer ${token({ iat: now - 600 })}`).expect(200); // not an admin
    } finally {
      revokedAt.value = null;
      await app.close();
    }
  });
});

describe('parseCookies', () => {
  it('parses, decodes, ignores malformed values and lets the first duplicate win', () => {
    expect(parseCookies('a=1; lp_at=x%20y; lp_at=evil; bad=%E0%A4%A; b=2')).toEqual({ a: '1', lp_at: 'x y', b: '2' });
    expect(parseCookies(undefined)).toEqual({});
  });
});
