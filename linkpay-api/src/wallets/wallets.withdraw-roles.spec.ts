import { ForbiddenException } from '@nestjs/common';
import { assertMayWithdraw, WITHDRAWAL_BLOCKED_ROLES } from './wallets.controller';

describe('who may withdraw', () => {
  it.each(WITHDRAWAL_BLOCKED_ROLES)('%s (staff) is refused with a clear message', (role) => {
    expect(() => assertMayWithdraw(role)).toThrow(ForbiddenException);
    expect(() => assertMayWithdraw(role)).toThrow(/Seul le patron/);
  });
  it.each(['client', 'merchant', 'enterprise', 'admin', 'super_admin'])('%s may', (role) => {
    expect(() => assertMayWithdraw(role)).not.toThrow();
  });
});
