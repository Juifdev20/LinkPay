import { createHash, createHmac, timingSafeEqual } from 'crypto';

/** How long one confirmation with the access code stays valid. */
export const CONFIRM_TTL_S = 5 * 60;

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

const keyFor = (secret: string) => createHash('sha256').update(`app-code-confirm:${secret}`).digest();

/**
 * A short-lived proof that THIS user has just typed their access code again.
 * Stateless and signed (HMAC), so it works across API instances and a restart
 * does not matter. It is useless to anyone else: it names the user and expires
 * in CONFIRM_TTL_S seconds.
 */
export function signConfirmToken(secret: string, userId: string, nowS = Math.floor(Date.now() / 1000)): string {
  const payload = b64(JSON.stringify({ sub: userId, exp: nowS + CONFIRM_TTL_S, p: 'confirm' }));
  return `${payload}.${b64(createHmac('sha256', keyFor(secret)).update(payload).digest())}`;
}

export function verifyConfirmToken(secret: string, token: string | undefined, userId: string, nowS = Math.floor(Date.now() / 1000)): boolean {
  if (!token || typeof token !== 'string') return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = createHmac('sha256', keyFor(secret)).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.p === 'confirm' && data.sub === userId && typeof data.exp === 'number' && data.exp > nowS;
  } catch {
    return false;
  }
}
