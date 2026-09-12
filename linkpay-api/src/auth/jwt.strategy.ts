import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { SESSION_TRACKING_EXEMPT_ROLES } from './constants';
import { getRequiredJwtSecret } from './jwt-secret.util';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  merchant_id?: string;
  session_id?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private supabaseService: SupabaseService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getRequiredJwtSecret(configService),
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload.sub) {
      throw new UnauthorizedException('Invalid token');
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
    };
  }
}
