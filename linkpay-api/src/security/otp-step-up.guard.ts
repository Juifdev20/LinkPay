import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TwoFactorService } from './two-factor.service';

export const REQUIRE_OTP_KEY = 'requireOtp';
/** Marks an endpoint as dangerous enough to need a fresh authenticator code. */
export const RequireOtp = () => SetMetadata(REQUIRE_OTP_KEY, true);

/** A code typed at login covers the first minutes of the session. */
export const FRESH_MFA_WINDOW_S = 5 * 60;

/**
 * Step-up authentication: even with a valid admin session (a stolen laptop
 * left open, a token lifted from the browser), changing who is super admin,
 * the commission, the wallet limits or anyone's 2FA needs a code from the
 * admin's phone. Send it in the `x-otp-code` header. The code typed at login
 * counts for FRESH_MFA_WINDOW_S so a freshly logged-in admin isn't asked twice.
 */
@Injectable()
export class OtpStepUpGuard implements CanActivate {
  constructor(private reflector: Reflector, private twoFactor: TwoFactorService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.reflector.getAllAndOverride<boolean>(REQUIRE_OTP_KEY, [context.getHandler(), context.getClass()])) {
      return true;
    }
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user) throw new ForbiddenException();

    if (user.mfa_at && Date.now() / 1000 - user.mfa_at < FRESH_MFA_WINDOW_S) return true;

    const code = req.headers['x-otp-code'];
    if (!code || Array.isArray(code)) {
      throw new ForbiddenException({ statusCode: 403, code: 'OTP_STEP_UP_REQUIRED', message: 'Saisissez le code de votre application d\'authentification pour confirmer cette action.' });
    }
    await this.twoFactor.assertValid(user.id, code);
    return true;
  }
}
