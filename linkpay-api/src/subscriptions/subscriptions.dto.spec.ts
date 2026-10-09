import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { PricesDto, QuoteDto, SettingsDto, SubscribeDto } from './subscriptions.controller';

// Same options as main.ts: a field the DTO doesn't declare is rejected, one it declares must survive.
const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
const run = (metatype: any, body: any) => pipe.transform(body, { type: 'body', metatype } as any);

describe('subscription DTOs (with the production ValidationPipe)', () => {
  it('keeps the prices the super admin sends', async () => {
    const out: any = await run(PricesDto, { prices: { CDF: 1500000, USD: null } });
    expect(out.prices).toEqual({ CDF: 1500000, USD: null });
  });

  it('rejects unknown fields', async () => {
    await expect(run(PricesDto, { prices: {}, evil: 1 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(run(SubscribeDto, { months: 1, currency: 'CDF', pin: '1234', amount_cents: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('subscribe: months 1-24, known currency, numeric PIN', async () => {
    await expect(run(SubscribeDto, { months: 3, currency: 'CDF', pin: '1234' })).resolves.toBeDefined();
    for (const bad of [{ months: 0 }, { months: 25 }, { months: 1.5 }, { currency: 'EUR' }, { pin: 'abcd' }, { pin: '12' }]) {
      await expect(run(SubscribeDto, { months: 1, currency: 'CDF', pin: '1234', ...bad })).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(run(QuoteDto, { months: 2, currency: 'USD' })).resolves.toBeDefined();
  });

  it('settings: trial 0-365, modes, reminder days', async () => {
    await expect(run(SettingsDto, { trial_days: 14, trial_end_mode: 'blocked', expiry_mode: 'read_only', reminder_days: [10, 5, 2] })).resolves.toBeDefined();
    for (const bad of [{ trial_days: -1 }, { trial_days: 366 }, { trial_end_mode: 'open' }, { reminder_days: [0] }, { reminder_days: [91] }]) {
      await expect(run(SettingsDto, bad)).rejects.toBeInstanceOf(BadRequestException);
    }
  });
});
