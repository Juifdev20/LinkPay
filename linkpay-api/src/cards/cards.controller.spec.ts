import { ExecutionContext, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../common/guards/roles.guard';
import {
  ActivateCardDto, BlockCardDto, CardChargesController, CardsAdminController, CardsController, CreateChargeDto, IssueCardDto, PinDto,
} from './cards.controller';

const guard = new RolesGuard(new Reflector());
const allowed = (Controller: any, method: string, role: string) => {
  const ctx = {
    getHandler: () => Controller.prototype[method],
    getClass: () => Controller,
    switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
  } as unknown as ExecutionContext;
  try {
    return guard.canActivate(ctx);
  } catch (e) {
    if (e instanceof ForbiddenException) return false;
    throw e;
  }
};

describe('who may do what', () => {
  it('the till is for sellers only: a plain client, an accountant, a stock keeper cannot charge cards', () => {
    for (const method of ['create', 'status', 'cancel']) {
      for (const role of ['merchant', 'enterprise', 'cashier', 'caissier', 'vendeur']) expect(allowed(CardChargesController, method, role)).toBe(true);
      for (const role of ['client', 'comptable', 'magasinier', 'admin', 'super_admin']) expect(allowed(CardChargesController, method, role)).toBe(false);
    }
  });

  it('an enterprise owner acting as one of their stores can charge cards', () => {
    const ctx = {
      getHandler: () => CardChargesController.prototype.create,
      getClass: () => CardChargesController,
      switchToHttp: () => ({ getRequest: () => ({ user: { role: 'merchant', acting_as_org_id: 'o1' } }) }),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('printing and issuing are for administrators; nobody else', () => {
    for (const method of ['list', 'settings', 'issue', 'print', 'block']) {
      for (const role of ['admin', 'super_admin']) expect(allowed(CardsAdminController, method, role)).toBe(true);
      for (const role of ['client', 'merchant', 'enterprise', 'caissier', 'comptable']) expect(allowed(CardsAdminController, method, role)).toBe(false);
    }
  });

  it('changing the settings is for the super admin only', () => {
    expect(allowed(CardsAdminController, 'updateSettings', 'super_admin')).toBe(true);
    expect(allowed(CardsAdminController, 'updateSettings', 'admin')).toBe(false);
  });

  it('every other person manages their own card: no role needed, the user id comes from the session', () => {
    for (const method of ['me', 'request', 'activate', 'freeze', 'unfreeze', 'reportLost', 'resolve', 'pending', 'approve', 'decline']) {
      expect(allowed(CardsController, method, 'client')).toBe(true);
    }
  });

  it('the settings change asks for a fresh one-time code', () => {
    const meta = Reflect.getMetadataKeys(CardsAdminController.prototype.updateSettings);
    expect(meta.some((k: any) => String(k).toLowerCase().includes('otp'))).toBe(true);
  });
});

describe('what the API accepts (same pipe as main.ts)', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const check = (metatype: any, body: any) => pipe.transform(body, { type: 'body', metatype });
  const UUID = '11111111-1111-4111-8111-111111111111';

  it('activation: 16 digits (spaces allowed by the service) and a numeric PIN', async () => {
    await expect(check(ActivateCardDto, { card_number: '9243 0012 3456 7895', pin: '1234' })).resolves.toBeDefined();
    await expect(check(ActivateCardDto, { card_number: '9243', pin: 'abcd' })).rejects.toBeDefined();
    await expect(check(ActivateCardDto, { card_number: '9243', pin: '1234', extra: 1 })).rejects.toBeDefined();
    await expect(check(PinDto, { pin: '12' })).rejects.toBeDefined();
  });

  it('a charge: a real amount in a real currency, nothing else', async () => {
    const ok = { qr_token: 'K7Q2M9XD4TWB', amount_cents: 50000, currency: 'CDF' };
    await expect(check(CreateChargeDto, ok)).resolves.toBeDefined();
    for (const bad of [{ ...ok, amount_cents: 99 }, { ...ok, amount_cents: 1.5 }, { ...ok, amount_cents: -5 }, { ...ok, currency: 'EUR' }, { ...ok, amount_cents: '500' }, { ...ok, merchant_id: 'x' }]) {
      await expect(check(CreateChargeDto, bad)).rejects.toBeDefined();
    }
  });

  it('issuing and blocking', async () => {
    await expect(check(IssueCardDto, { wallet_number: 'LP-00000001', replace: true })).resolves.toBeDefined();
    await expect(check(IssueCardDto, { card_id: UUID })).resolves.toBeDefined();
    await expect(check(IssueCardDto, { card_id: 'nope' })).rejects.toBeDefined();
    await expect(check(IssueCardDto, { replace: 'yes' })).rejects.toBeDefined();
    await expect(check(BlockCardDto, { reason: 'lost' })).resolves.toBeDefined();
    await expect(check(BlockCardDto, {})).rejects.toBeDefined();
  });
});
