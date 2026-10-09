import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { accessTokenFromCookie } from './auth-cookies';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { MFA_REQUIRED_ROLES, SESSION_TRACKING_EXEMPT_ROLES } from './constants';
import { getRequiredJwtSecret } from './jwt-secret.util';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  merchant_id?: string;
  organization_id?: string;
  session_id?: string;
  acting_as_org_id?: string;
  mfa?: boolean;
  mfa_at?: number;
  type?: string;
  iat?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private supabaseService: SupabaseService,
  ) {
    const cookieMode = configService.get<string>('COOKIE_AUTH') === 'true';
    super({
      // The Authorization header (Android app, API clients) first, then — only for a browser that announced cookie
      // mode — the HttpOnly cookie. The same condition decides when tokens are kept out of response bodies
      // (CookieAuthInterceptor), so a script can't get a cookie-authenticated request to answer with tokens.
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: any) => (cookieMode && req?.headers?.['x-auth-mode'] === 'cookie' ? accessTokenFromCookie(req) : null),
      ]),
      ignoreExpiration: false,
      secretOrKey: getRequiredJwtSecret(configService),
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload.sub) {
      throw new UnauthorizedException('Invalid token');
    }
    // A refresh token is not an access token: it lives for months and carries no role, so it would skip the
    // administrator checks below.
    if (payload.type === 'refresh') {
      throw new UnauthorizedException('Invalid token');
    }

    // Administrators: logout, "reset session", a 2FA reset or a role change kill every token issued before it.
    if (MFA_REQUIRED_ROLES.includes(payload.role)) {
      const { data } = await this.supabaseService.getClient().from('profiles').select('tokens_valid_after').eq('id', payload.sub).maybeSingle();
      if (data?.tokens_valid_after && (payload.iat ?? 0) < Math.floor(new Date(data.tokens_valid_after).getTime() / 1000)) {
        throw new UnauthorizedException('Session revoked — please log in again');
      }
    }

    // Single-active-session enforcement: if another device has since taken
    // over (or an admin reset the session), this token is stale even though
    // it hasn't technically expired yet — reject immediately. Admins/super
    // admins are exempt (unlimited concurrent devices) — checked via the
    // role already embedded in this token, so it takes effect immediately
    // even for a token minted before this exemption existed, not just new
    // logins.
    if (payload.session_id && !SESSION_TRACKING_EXEMPT_ROLES.includes(payload.role)) {
      const { data: profile } = await this.supabaseService.getClient()
        .from('profiles')
        .select('active_session_id')
        .eq('id', payload.sub)
        .single();

      if (!profile || profile.active_session_id !== payload.session_id) {
        throw new UnauthorizedException('Session no longer active — please log in again');
      }
    }

    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      merchant_id: payload.merchant_id,
      organization_id: payload.organization_id,
      acting_as_org_id: payload.acting_as_org_id,
      // True only for a token minted after an authenticator code was checked.
      mfa: payload.mfa === true,
      mfa_at: payload.mfa === true ? payload.mfa_at : undefined,
      session_id: payload.session_id,
    };
  }
}
