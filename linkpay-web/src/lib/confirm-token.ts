/**
 * The 5-minute proof that the user just re-typed their access code (see the
 * API's AppCodeConfirmGuard). Kept in memory only: closing the app forgets it.
 */
let token: string | null = null;
let expiresAt = 0;

export function setConfirmToken(value: string, expiresInS: number) {
  token = value;
  expiresAt = Date.now() + expiresInS * 1000 - 5_000; // a margin so it doesn't expire mid-request
}

export function getConfirmToken(): string | null {
  return token && Date.now() < expiresAt ? token : null;
}

export function clearConfirmToken() {
  token = null;
  expiresAt = 0;
}
