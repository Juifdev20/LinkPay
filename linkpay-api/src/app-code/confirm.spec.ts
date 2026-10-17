import { ForbiddenException } from '@nestjs/common';
import { AppCodeConfirmGuard, REQUIRE_APP_CODE_KEY } from '../common/guards/app-code-confirm.guard';
import { CONFIRM_TTL_S, signConfirmToken, verifyConfirmToken } from './confirm-token';

const SECRET = 's'.repeat(48);

describe('confirm token', () => {
  it('is valid for its user for a few minutes, then expires', () => {
    const now = 1_800_000_000;
    const t = signConfirmToken(SECRET, 'u1', now);
    expect(verifyConfirmToken(SECRET, t, 'u1', now + 10)).toBe(true);
    expect(verifyConfirmToken(SECRET, t, 'u1', now + CONFIRM_TTL_S - 1)).toBe(true);
    expect(verifyConfirmToken(SECRET, t, 'u1', now + CONFIRM_TTL_S + 1)).toBe(false);
  });
  it('cannot be used by someone else, forged, tampered with or signed with another secret', () => {
    const now = 1_800_000_000;
    const t = signConfirmToken(SECRET, 'u1', now);
    expect(verifyConfirmToken(SECRET, t, 'u2', now + 1)).toBe(false);
    expect(verifyConfirmToken('x'.repeat(48), t, 'u1', now + 1)).toBe(false);
    const [payload, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'u1', exp: now + 99999, p: 'confirm' })).toString('base64url');
    expect(verifyConfirmToken(SECRET, `${forged}.${sig}`, 'u1', now + 1)).toBe(false);
    expect(verifyConfirmToken(SECRET, `${payload}.AAAA`, 'u1', now + 1)).toBe(false);
    for (const bad of [undefined, '', 'abc', 'a.b.c', '.']) expect(verifyConfirmToken(SECRET, bad as any, 'u1', now)).toBe(false);
  });
});

describe('AppCodeConfirmGuard', () => {
  const ctx = (user: any, headers: any = {}) => ({
    getHandler: () => 'h', getClass: () => 'c',
    switchToHttp: () => ({ getRequest: () => ({ user, headers }) }),
  }) as any;
  const guard = (required: boolean) => new AppCodeConfirmGuard(
    { getAllAndOverride: (k: string) => (k === REQUIRE_APP_CODE_KEY ? required : undefined) } as any,
    { get: (k: string) => (k === 'JWT_SECRET' ? SECRET : undefined) } as any,
  );

  it('leaves unmarked endpoints alone', () => {
    expect(guard(false).canActivate(ctx({ id: 'u1', role: 'vendeur' }))).toBe(true);
  });
  it('demands a confirmation when none is sent, with a code the app understands', () => {
    try { guard(true).canActivate(ctx({ id: 'u1', role: 'magasinier' })); fail('should throw'); }
    catch (e: any) { expect(e).toBeInstanceOf(ForbiddenException); expect(e.getResponse().code).toBe('APP_CODE_CONFIRM_REQUIRED'); }
  });
  it("accepts the user's own fresh token and refuses another user's or a junk one", () => {
    const token = signConfirmToken(SECRET, 'u1');
    expect(guard(true).canActivate(ctx({ id: 'u1', role: 'enterprise' }, { 'x-confirm-token': token }))).toBe(true);
    expect(() => guard(true).canActivate(ctx({ id: 'u2', role: 'enterprise' }, { 'x-confirm-token': token }))).toThrow(ForbiddenException);
    expect(() => guard(true).canActivate(ctx({ id: 'u1', role: 'enterprise' }, { 'x-confirm-token': 'junk' }))).toThrow(ForbiddenException);
  });
  it('does not ask administrators (they have the authenticator login)', () => {
    expect(guard(true).canActivate(ctx({ id: 'a1', role: 'super_admin' }))).toBe(true);
  });
});
