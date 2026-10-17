import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { getRequiredJwtSecret } from '../../auth/jwt-secret.util';
import { MFA_REQUIRED_ROLES } from '../../auth/constants';
import { verifyConfirmToken } from '../../app-code/confirm-token';

export const REQUIRE_APP_CODE_KEY = 'requireAppCode';

/**
 * Marks an action as sensitive (changing stock, validating an inventory,
 * moving or closing the till): the person must have typed their own access
 * code within the last few minutes. The app shows the code dialog when the
 * API answers 403 APP_CODE_CONFIRM_REQUIRED, then repeats the request with the
 * token from POST /auth/app-code/confirm in the `x-confirm-token` header.
 *
 * Applied to the API, not just the screen: a request that skips the
 * interface — or a phone left unlocked on the till — still can't change the
 * stock or the cash without the person's code.
 * Administrators are not asked: they have the authenticator-app login.
 */
export const RequireAppCode = () => SetMetadata(REQUIRE_APP_CODE_KEY, true);

@Injectable()
export class AppCodeConfirmGuard implements CanActivate {
  constructor(private reflector: Reflector, private config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.reflector.getAllAndOverride<boolean>(REQUIRE_APP_CODE_KEY, [context.getHandler(), context.getClass()])) {
      return true;
    }
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user) throw new ForbiddenException();
    if (MFA_REQUIRED_ROLES.includes(user.role)) return true;

    const token = req.headers['x-confirm-token'];
    if (typeof token === 'string' && verifyConfirmToken(getRequiredJwtSecret(this.config), token, user.id)) return true;

    throw new ForbiddenException({
      statusCode: 403,
      code: 'APP_CODE_CONFIRM_REQUIRED',
      message: 'Confirmez cette action avec votre code d’accès.',
    });
  }
}
