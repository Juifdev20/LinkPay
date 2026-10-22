/**
 * Unlocking the app without network.
 *
 * The access code is normally checked by the server (5 tries, then a lock). Offline, the person must still get past
 * the lock screen to read their balance or use the till, so each successful online check leaves on the device a
 * one-way fingerprint of the code (PBKDF2-SHA256, random salt, 200 000 rounds) — never the code itself. Offline, the
 * typed code is compared with it. 5 wrong codes offline erase the fingerprint: only the server can unlock after that.
 * Changing or resetting the code erases it too. It opens nothing more than the screen: moving money always asks the
 * server.
 */
const KEY = (userId: string) => `linkpay_offline_code_${userId}`;
const ROUNDS = 200_000;
export const OFFLINE_CODE_TRIES = 5;

interface Stored { salt: string; hash: string; fails: number }

const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;

async function derive(code: string, salt: Uint8Array<ArrayBuffer>): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ROUNDS }, key, 256);
  return b64(bits);
}

function read(userId: string): Stored | null {
  try {
    const raw = localStorage.getItem(KEY(userId));
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

const write = (userId: string, s: Stored) => {
  try { localStorage.setItem(KEY(userId), JSON.stringify(s)); } catch { /* not kept: offline unlock unavailable */ }
};

export function forgetOfflineCode(userId?: string | null) {
  if (!userId) return;
  try { localStorage.removeItem(KEY(userId)); } catch { /* nothing kept */ }
}

/** After the server accepted the code. */
export async function rememberOfflineCode(userId: string | undefined, code: string) {
  if (!userId || !crypto?.subtle) return;
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    write(userId, { salt: b64(salt), hash: await derive(code, salt), fails: 0 });
  } catch { /* offline unlock simply unavailable */ }
}

export type OfflineCheck = { result: 'ok' } | { result: 'wrong'; left: number } | { result: 'unavailable' } | { result: 'locked' };

export async function checkOfflineCode(userId: string | undefined, code: string): Promise<OfflineCheck> {
  if (!userId || !crypto?.subtle) return { result: 'unavailable' };
  const stored = read(userId);
  if (!stored) return { result: 'unavailable' };
  let same = false;
  try {
    same = (await derive(code, unb64(stored.salt))) === stored.hash;
  } catch {
    return { result: 'unavailable' };
  }
  if (same) {
    write(userId, { ...stored, fails: 0 });
    return { result: 'ok' };
  }
  const fails = stored.fails + 1;
  if (fails >= OFFLINE_CODE_TRIES) {
    forgetOfflineCode(userId);
    return { result: 'locked' };
  }
  write(userId, { ...stored, fails });
  return { result: 'wrong', left: OFFLINE_CODE_TRIES - fails };
}
