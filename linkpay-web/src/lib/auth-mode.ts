import { Capacitor } from '@capacitor/core';

/**
 * Where the session lives.
 *
 * Cookie mode (browser, build with VITE_AUTH_COOKIES=true and an API on the same site — see
 * docs/COOKIES_HTTPONLY.md): the API puts the tokens in HttpOnly cookies. JavaScript never sees
 * them, so a script injected into the page cannot steal the session. The browser attaches them
 * itself; this app only keeps a harmless "I am signed in" flag.
 *
 * Token mode (default, and always inside the Android app / native shells, whose origin can't
 * share a cookie with the API): tokens are kept in storage and sent in the Authorization header.
 */
export const COOKIE_AUTH = import.meta.env.VITE_AUTH_COOKIES === 'true' && !Capacitor.isNativePlatform();

/** Headers every request carries in cookie mode (the API refuses cookie-authenticated writes without them). */
export const COOKIE_HEADERS = { 'x-auth-mode': 'cookie', 'x-requested-with': 'ScanLinkPay' } as const;
