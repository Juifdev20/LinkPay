import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const ACCESS_COOKIE = 'lp_at';
export const REFRESH_COOKIE = 'lp_rt';
/** Sent by our web app (and only by it) when it keeps the session in HttpOnly cookies instead of JavaScript-readable storage. */
export const AUTH_MODE_HEADER = 'x-auth-mode';
/** Custom header our web app adds to every request: a cross-site form or image can't set it, a cross-site script can't without a CORS preflight we refuse. */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'ScanLinkPay';
/** "0" = a session cookie that dies when the browser closes ("Se souvenir de moi" unchecked). */
export const REMEMBER_HEADER = 'x-auth-remember';

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (!name || name in out) continue; // first one wins: a duplicate can't override
    try { out[name] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* malformed value: ignore */ }
  }
  return out;
}

/** Express/passport extractor: the access token from its cookie. */
export const accessTokenFromCookie = (req: any): string | null => parseCookies(req?.headers?.cookie)[ACCESS_COOKIE] || null;

/**
 * Session tokens in HttpOnly cookies — the browser keeps them, JavaScript (so an injected
 * script) can never read them. Opt-in, for BROWSER clients only (the Android app and native
 * shells keep using the Authorization header: a cookie can't cross their origin).
 *
 *   COOKIE_AUTH=true        turns it on (the web app must also be built with VITE_AUTH_COOKIES=true)
 *   COOKIE_SAMESITE=strict  strict (default, same-site deployment) | lax | none (cross-site: weaker, avoid)
 *   COOKIE_DOMAIN=          only to share the cookie between subdomains (e.g. .scanlinkpay.com)
 *
 * The cookie is Secure outside development. The refresh cookie is only sent to /api/v1/auth.
 */
@Injectable()
export class AuthCookiesService {
  constructor(private config: ConfigService) {}

  get enabled(): boolean {
    return this.config.get<string>('COOKIE_AUTH') === 'true';
  }

  /** The caller asked for cookie mode AND the server allows it. */
  isCookieClient(req: any): boolean {
    return this.enabled && req?.headers?.[AUTH_MODE_HEADER] === 'cookie';
  }

  private sameSite(): 'strict' | 'lax' | 'none' {
    const v = (this.config.get<string>('COOKIE_SAMESITE') || 'strict').toLowerCase();
    return v === 'lax' || v === 'none' ? v : 'strict';
  }

  private baseOptions(path: string) {
    const sameSite = this.sameSite();
    const domain = this.config.get<string>('COOKIE_DOMAIN');
    return {
      httpOnly: true,
      // SameSite=None is only accepted with Secure; otherwise Secure everywhere but local development.
      secure: sameSite === 'none' || this.config.get<string>('NODE_ENV') === 'production',
      sameSite,
      path,
      ...(domain ? { domain } : {}),
    };
  }

  /** Cookie lifetime = the token's own lifetime (its `exp`), so the two can never disagree. */
  private maxAge(token: string): number | undefined {
    let exp: number | undefined;
    try {
      exp = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).exp;
    } catch { /* not a JWT: session cookie */ }
    return exp ? Math.max(0, exp * 1000 - Date.now()) : undefined;
  }

  set(res: any, tokens: { access_token?: string; refresh_token?: string }, remember: boolean) {
    if (tokens.access_token) {
      res.cookie(ACCESS_COOKIE, tokens.access_token, {
        ...this.baseOptions('/api/v1'),
        ...(remember ? { maxAge: this.maxAge(tokens.access_token) } : {}),
      });
    }
    if (tokens.refresh_token) {
      res.cookie(REFRESH_COOKIE, tokens.refresh_token, {
        ...this.baseOptions('/api/v1/auth'),
        ...(remember ? { maxAge: this.maxAge(tokens.refresh_token) } : {}),
      });
    }
  }

  clear(res: any) {
    res.clearCookie(ACCESS_COOKIE, this.baseOptions('/api/v1'));
    res.clearCookie(REFRESH_COOKIE, this.baseOptions('/api/v1/auth'));
  }

  refreshTokenFrom(req: any): string | undefined {
    return parseCookies(req?.headers?.cookie)[REFRESH_COOKIE];
  }
}
