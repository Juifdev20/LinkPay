const REMEMBER_KEY = 'linkpay_remember_me';
const ACCESS_KEY = 'linkpay_access_token';
const REFRESH_KEY = 'linkpay_refresh_token';
const TOKEN_KEYS = [ACCESS_KEY, REFRESH_KEY];

/**
 * "Se souvenir de moi" storage backend switch — checked (default, matches
 * the app's original always-on behavior) keeps tokens in localStorage, so
 * the session survives closing the browser/PWA and reopening it days later.
 * Unchecked keeps them in sessionStorage only, so the session ends the
 * moment the browser/PWA is actually closed (a same-tab reload still works,
 * since sessionStorage survives that).
 *
 * The flag itself always lives in localStorage — it carries no secret, only
 * a boolean — because it has to be readable at next app boot to know which
 * storage to check; if it were itself session-scoped there'd be no way to
 * tell "remember me was off" from "never logged in" once the tab closes.
 */
function isRemembering(): boolean {
  const v = localStorage.getItem(REMEMBER_KEY);
  return v === null ? true : v === '1';
}

function activeStore(): Storage {
  return isRemembering() ? localStorage : sessionStorage;
}

function inactiveStore(): Storage {
  return isRemembering() ? sessionStorage : localStorage;
}

export function setRememberMe(remember: boolean) {
  localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0');
}

export function getRememberMe(): boolean {
  return isRemembering();
}

export function getToken(key: string): string | null {
  return activeStore().getItem(key);
}

export function setTokens(accessToken: string, refreshToken: string) {
  activeStore().setItem(ACCESS_KEY, accessToken);
  activeStore().setItem(REFRESH_KEY, refreshToken);
  // Never let a stale copy linger in the OTHER storage — e.g. the user
  // logged in with "remember me" unchecked after a previous session had it
  // checked (or vice versa). A leftover token there could otherwise get
  // picked up if isRemembering() ever disagreed between two reads.
  TOKEN_KEYS.forEach((k) => inactiveStore().removeItem(k));
}

export function setAccessToken(accessToken: string) {
  activeStore().setItem(ACCESS_KEY, accessToken);
}

export function clearTokens() {
  TOKEN_KEYS.forEach((k) => {
    localStorage.removeItem(k);
    sessionStorage.removeItem(k);
  });
}

export const TOKEN_ACCESS_KEY = ACCESS_KEY;
export const TOKEN_REFRESH_KEY = REFRESH_KEY;
