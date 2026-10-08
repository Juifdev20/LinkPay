import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.role) {
      throw new ForbiddenException('No role assigned');
    }

    // An enterprise owner acting as one of their stores authenticates with
    // role 'merchant' + acting_as_org_id — for role checks they keep their
    // enterprise privileges (they own the org behind the store).
    const effectiveRole =
      user.role === 'merchant' && user.acting_as_org_id ? 'enterprise' : user.role;

    const hasRole = requiredRoles.includes(effectiveRole);
    if (!hasRole) {
      throw new ForbiddenException(
        `Required role: ${requiredRoles.join(' or ')}`,
      );
    }

    return true;
  }
}
