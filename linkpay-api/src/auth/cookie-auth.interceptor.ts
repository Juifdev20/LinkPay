import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AuthCookiesService, REMEMBER_HEADER } from './auth-cookies';

/**
 * Cookie-mode clients never get their tokens in the response body. Whatever endpoint hands out
 * a session (login, register, refresh, 2FA setup, store switch, account upgrades…) — this puts
 * the tokens into HttpOnly cookies and removes them from the JSON, so a script on the page has
 * nothing to steal. The Supabase realtime session is withheld too: it is a second login to the
 * same account that a script could use and keep.
 *
 * Other clients (the Android app, API consumers) are untouched.
 */
@Injectable()
export class CookieAuthInterceptor implements NestInterceptor {
  constructor(private cookies: AuthCookiesService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const req = http.getRequest();
    if (!this.cookies.isCookieClient(req)) return next.handle();
    const res = http.getResponse();

    return next.handle().pipe(
      map((body) => {
        if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
        if (!('access_token' in body) && !('refresh_token' in body)) return body;
        const { access_token, refresh_token, supabase_session: _dropped, ...rest } = body as Record<string, any>;
        const remember = req.headers?.[REMEMBER_HEADER] !== '0';
        this.cookies.set(res, { access_token, refresh_token }, remember);
        return { ...rest, session_in_cookie: true };
      }),
    );
  }
}
