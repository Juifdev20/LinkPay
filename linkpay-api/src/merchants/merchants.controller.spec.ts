import { ForbiddenException } from '@nestjs/common';
import { MerchantsController } from './merchants.controller';

describe('MerchantsController.updateMerchant', () => {
  const merchantsService = { updateMerchant: jest.fn(async (_id: string, u: any) => u) };
  const controller = new MerchantsController(merchantsService as any);
  beforeEach(() => merchantsService.updateMerchant.mockClear());

  it("refuses a cashier, even with their store's merchant_id", async () => {
    await expect(controller.updateMerchant('m1', { name: 'Arnaque' }, 'm1', 'cashier')).rejects.toBeInstanceOf(ForbiddenException);
    expect(merchantsService.updateMerchant).not.toHaveBeenCalled();
  });

  it("refuses an owner editing another store", async () => {
    await expect(controller.updateMerchant('m2', { name: 'X' }, 'm1', 'merchant')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses an owner changing admin-only fields', async () => {
    await expect(controller.updateMerchant('m1', { status: 'active' }, 'm1', 'merchant')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets the owner set their payout account', async () => {
    const settlement_account = { method: 'mobile_money', operator: 'M-Pesa', number: '0990000000', holder_name: 'Jean' };
    await controller.updateMerchant('m1', { settlement_account }, 'm1', 'merchant');
    expect(merchantsService.updateMerchant).toHaveBeenCalledWith('m1', { settlement_account });
  });

  it('lets an admin change the status of any store', async () => {
    await controller.updateMerchant('m9', { status: 'suspended' }, undefined as any, 'admin');
    expect(merchantsService.updateMerchant).toHaveBeenCalledWith('m9', { status: 'suspended' });
  });
});

describe('UpdateMerchantDto validation (same options as main.ts)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ValidationPipe } = require('@nestjs/common');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { UpdateMerchantDto } = require('./merchants.controller');
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const validate = (body: any) => pipe.transform(body, { type: 'body', metatype: UpdateMerchantDto });

  it('rejects fields that are not part of a store profile (e.g. owner_id)', async () => {
    await expect(validate({ owner_id: 'someone-else' })).rejects.toBeDefined();
  });

  it('rejects an incomplete payout account', async () => {
    await expect(validate({ settlement_account: { method: 'mobile_money', number: '12' } })).rejects.toBeDefined();
  });

  it('accepts a valid payout account', async () => {
    const dto = await validate({ settlement_account: { method: 'mobile_money', operator: 'M-Pesa', number: '0990000000', holder_name: 'Jean' } });
    expect(dto.settlement_account.number).toBe('0990000000');
  });
});
