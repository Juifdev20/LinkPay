import { applyDecorators, CanActivate, ExecutionContext, Injectable, UseGuards } from '@nestjs/common';
import { MFA_REQUIRED_ROLES } from '../auth/constants';
import { DeviceIntegrityService } from './device-integrity.service';

@Injectable()
export class DeviceIntegrityGuard implements CanActivate {
  constructor(private integrity: DeviceIntegrityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    // Administrators sign in with an authenticator app and don't move customers' money from a phone.
    if (!user || MFA_REQUIRED_ROLES.includes(user.role)) return true;
    await this.integrity.assertMoneyOutAllowed(user.id, req.headers?.['x-client-platform']);
    return true;
  }
}

/** On the endpoints that make money leave a wallet (transfer, withdrawal). */
export const RequireDeviceIntegrity = () => applyDecorators(UseGuards(DeviceIntegrityGuard));
