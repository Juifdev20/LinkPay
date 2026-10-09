import { Injectable, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ALLOW_WITHOUT_MFA_KEY } from '../decorators/allow-without-mfa.decorator';
import { MFA_REQUIRED_ROLES } from '../../auth/constants';
import { isAdminIpAllowed } from '../../security/admin-ip';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector, private config: ConfigService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      // Optional auth, not "skip auth": still run the JWT strategy so a
      // logged-in user's request.user gets populated when a valid token is
      // present (e.g. paying a public invoice link while authenticated —
      // @CurrentUser('id') needs this to attach the transaction to them
      // instead of leaving it anonymous). Previously this returned true
      // immediately without ever running the strategy, so req.user was
      // never set even with a perfectly valid Bearer token. Never reject
      // the request just because the token is missing/invalid, though —
      // that's still the whole point of @Public().
      try {
        await super.canActivate(context);
      } catch {
        // No/invalid token on a public route — fine, proceed anonymously.
      }
      return true;
    }

    const ok = (await super.canActivate(context)) as boolean;

    // Administrators: a password alone is never enough. A session that hasn't
    // passed the authenticator-app check can only reach the endpoints that set
    // it up; and, if configured, admins only work from the allowed networks.
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (user && MFA_REQUIRED_ROLES.includes(user.role)) {
      if (!isAdminIpAllowed(this.config.get<string>('ADMIN_ALLOWED_IPS'), req.ip)) {
        throw new ForbiddenException('Accès administrateur refusé depuis ce réseau');
      }
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_MFA_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!user.mfa && !allowed) {
        throw new ForbiddenException({
          statusCode: 403,
          code: 'MFA_REQUIRED',
          message: "Activez la double authentification pour utiliser l'administration.",
        });
      }
    }
    return ok;
  }
}
