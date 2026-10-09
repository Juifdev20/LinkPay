import { applyDecorators, CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MFA_REQUIRED_ROLES } from '../auth/constants';
import { LicenseFeatureKey } from './license-features';
import { LicensesService } from './licenses.service';

export const LICENSE_KEY = 'requireLicense';

/** Where to find the business in the route: `:id` is the organization itself, or a store (merchant) that belongs to one. */
export type LicenseScope = 'org' | 'merchant';

/**
 * Marks a controller or an endpoint as a licensed feature. Put it ABOVE
 * @UseGuards(RolesGuard) so the role check runs first.
 * Administrators are never blocked; a plain merchant (no business behind it) isn't licensed.
 * Payments, wallets and withdrawals are deliberately never marked: money coming
 * in and out of ScanLinkPay must keep working whatever the licence says.
 */
export const RequireLicense = (feature: LicenseFeatureKey, scope: LicenseScope) =>
  applyDecorators(SetMetadata(LICENSE_KEY, { feature, scope }), UseGuards(LicenseGuard));

const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];

@Injectable()
export class LicenseGuard implements CanActivate {
  constructor(private reflector: Reflector, private licenses: LicensesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<{ feature: LicenseFeatureKey; scope: LicenseScope } | undefined>(LICENSE_KEY, [
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
    const orgId = meta.scope === 'org' ? id : await this.licenses.organizationOfMerchant(id);
    if (!orgId) return true;

    await this.licenses.assertAccess(orgId, meta.feature, !READ_METHODS.includes(req.method));
    return true;
  }
}
