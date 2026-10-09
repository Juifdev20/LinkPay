import { applyDecorators, CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MFA_REQUIRED_ROLES } from '../auth/constants';
import { SubscriptionsService } from './subscriptions.service';

export const SUBSCRIPTION_KEY = 'requireSubscription';

/** Where to find the business in the route: `:id` is the organization itself, or a store (merchant) that belongs to one. */
export type SubscriptionScope = 'org' | 'merchant';

/**
 * Marks a controller or an endpoint as part of the business tools covered by
 * the monthly subscription. Put it ABOVE @UseGuards(RolesGuard) so the role
 * check runs first. Administrators are never blocked; a plain merchant (no
 * business behind it) isn't subject to it. Payments, wallets and withdrawals
 * are deliberately never marked: money coming in and out of ScanLinkPay must
 * keep working whatever the subscription says.
 */
export const RequireSubscription = (scope: SubscriptionScope) =>
  applyDecorators(SetMetadata(SUBSCRIPTION_KEY, { scope }), UseGuards(SubscriptionGuard));

const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private reflector: Reflector, private subscriptions: SubscriptionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<{ scope: SubscriptionScope } | undefined>(SUBSCRIPTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!meta) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user) throw new ForbiddenException();
    if (MFA_REQUIRED_ROLES.includes(user.role)) return true;

    const id = req.params?.id;
    if (!id) return true;
    const orgId = meta.scope === 'org' ? id : await this.subscriptions.organizationOfMerchant(id);
    if (!orgId) return true;

    await this.subscriptions.assertAccess(orgId, !READ_METHODS.includes(req.method));
    return true;
  }
}
