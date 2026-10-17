import { base32Decode, base32Encode, codeForStep, generateSecret, otpauthUrl, stepAt, verifyCode } from './totp';

// RFC 6238 appendix B test vectors (SHA-1, secret "12345678901234567890"), last 6 digits.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('totp', () => {
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('matches the RFC 6238 vector at t=%i', (t, expected) => {
    expect(codeForStep(RFC_SECRET, stepAt(t * 1000))).toBe(expected);
  });

  it('base32 round-trips', () => {
    const s = generateSecret();
    expect(base32Encode(base32Decode(s))).toBe(s);
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('accepts the current code and one step of drift, rejects older and malformed codes', () => {
    const now = 1_700_000_000_000;
    const step = stepAt(now);
    expect(verifyCode(RFC_SECRET, codeForStep(RFC_SECRET, step), now)).toBe(step);
    expect(verifyCode(RFC_SECRET, codeForStep(RFC_SECRET, step - 1), now)).toBe(step - 1);
    expect(verifyCode(RFC_SECRET, codeForStep(RFC_SECRET, step - 3), now)).toBeNull();
    expect(verifyCode(RFC_SECRET, '12345', now)).toBeNull();
    expect(verifyCode(RFC_SECRET, 'abcdef', now)).toBeNull();
  });

  it('builds a URL authenticator apps understand', () => {
    expect(otpauthUrl('ABC', 'a@b.com')).toMatch(/^otpauth:\/\/totp\/ScanLinkPay%3Aa%40b\.com\?secret=ABC&issuer=ScanLinkPay/);
  });
});
