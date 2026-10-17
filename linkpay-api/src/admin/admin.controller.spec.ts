import { ValidationPipe } from '@nestjs/common';
import { AdminController } from './admin.controller';

const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
const UUID = '11111111-1111-4111-8111-111111111111';

function make() {
  const adminService = { updateMerchantStatus: jest.fn(async () => ({ id: UUID })), resetUserSession: jest.fn(async () => ({ success: true })) };
  const audit = { log: jest.fn(async () => undefined) };
  const controller = new AdminController(adminService as any, audit as any, {} as any, {} as any);
  return { controller, adminService, audit };
}

describe('AdminController audited actions', () => {
  it('records who changed a store status, and to what', async () => {
    const { controller, audit } = make();
    await controller.updateMerchantStatus(UUID, { status: 'suspended', notes: 'fraude' }, 'admin1');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'admin1', action: 'MERCHANT_STATUS_CHANGED', entity_id: UUID }));
  });

  it('records who freed a user session', async () => {
    const { controller, audit } = make();
    await controller.resetSession(UUID, 'admin1');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'SESSION_RESET', entity_id: UUID }));
  });

  it('refuses a status that is not a real one', async () => {
    const { MerchantStatusDto } = require('./admin.controller');
    await expect(pipe.transform({ status: 'god_mode' }, { type: 'body', metatype: MerchantStatusDto })).rejects.toBeDefined();
    await expect(pipe.transform({ status: 'active' }, { type: 'body', metatype: MerchantStatusDto })).resolves.toBeDefined();
  });
});
