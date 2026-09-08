import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
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

    return (await super.canActivate(context)) as boolean;
  }
}
