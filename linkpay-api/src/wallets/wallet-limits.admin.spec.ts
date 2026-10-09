import { BadRequestException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { WalletLimitsService } from './wallet-limits.service';
import { UpdateWalletLimitDto, WalletLimitsController } from './wallet-limits.controller';
import { createFakeSupabase, has, RecordedQuery } from '../test-utils/fake-supabase';

const RULE = { id: 'r1', op_type: 'WITHDRAWAL', currency: 'CDF', applies_to: 'all', min_cents: 100, max_cents: 500000000, daily_max_cents: 500000000, monthly_max_cents: 5000000000, fee_percent: '0.0100', fee_fixed_cents: 0, is_active: true };

function setup(existing: any = RULE) {
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target !== 'wallet_limits') return undefined;
    return { data: has(q, 'update') ? { ...existing, updated: true } : existing };
  });
  return { service: new WalletLimitsService(fake.service), fake };
}
const sent = (fake: ReturnType<typeof setup>['fake']) =>
  fake.queries.find((q) => has(q, 'update'))?.calls.find((c) => c.method === 'update')?.args[0];

describe('WalletLimitsService.updateRule', () => {
  it('changes only the fields given and stamps updated_at', async () => {
    const { service, fake } = setup();
    await service.updateRule('r1', { fee_percent: 0.015 });
    const update = sent(fake);
    expect(update.fee_percent).toBe(0.015);
    expect(update.updated_at).toBeDefined();
    expect(Object.keys(update).sort()).toEqual(['fee_percent', 'updated_at']);
  });

  it('never lets op_type or currency change, even if passed in', async () => {
    const { service, fake } = setup();
    await service.updateRule('r1', { fee_percent: 0.02, op_type: 'TRANSFER', currency: 'USD' } as any);
    expect(sent(fake).op_type).toBeUndefined();
    expect(sent(fake).currency).toBeUndefined();
  });

  it('null removes a cap', async () => {
    const { service, fake } = setup();
    await service.updateRule('r1', { monthly_max_cents: null });
    expect(sent(fake).monthly_max_cents).toBeNull();
  });

  it('returns the rule before and after for the audit trail', async () => {
    const { service } = setup();
    const r = await service.updateRule('r1', { fee_percent: 0.02 });
    expect(r.before.fee_percent).toBe('0.0100');
    expect((r.after as any).updated).toBe(true);
  });

  it.each([
    [{ min_cents: 600000000 }, /minimum/],
    [{ daily_max_cents: 100 }, /quotidienne/],
    [{ monthly_max_cents: 100 }, /mensuelle/],
  ])('refuses inconsistent limits %j', async (changes, message) => {
    const { service, fake } = setup();
    await expect(service.updateRule('r1', changes as any)).rejects.toThrow(message);
    expect(sent(fake)).toBeUndefined();
  });

  it('404 for an unknown rule', async () => {
    const { service } = setup(null);
    await expect(service.updateRule('nope', { fee_percent: 0.01 })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('UpdateWalletLimitDto validation (same options as main.ts)', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const validate = (body: any) => pipe.transform(body, { type: 'body', metatype: UpdateWalletLimitDto });

  it('accepts a normal fee change and removing a cap', async () => {
    await expect(validate({ fee_percent: 0.01, fee_fixed_cents: 500, max_cents: null })).resolves.toBeDefined();
  });

  it('rejects an absurd fee (5 meant as 5 %, read as 500 %)', async () => {
    await expect(validate({ fee_percent: 5 })).rejects.toBeDefined();
    await expect(validate({ fee_percent: -0.01 })).rejects.toBeDefined();
  });

  it('rejects a zero cap, decimals in cents and unknown fields', async () => {
    await expect(validate({ max_cents: 0 })).rejects.toBeDefined();
    await expect(validate({ min_cents: 10.5 })).rejects.toBeDefined();
    await expect(validate({ op_type: 'TRANSFER' })).rejects.toBeDefined();
  });
});

describe('WalletLimitsController.update', () => {
  it('records who changed what in the audit log', async () => {
    const { service } = setup();
    const audit = { log: jest.fn(async () => undefined) };
    const alerts = { alert: jest.fn(async () => undefined) };
    const controller = new WalletLimitsController(service, audit as any, alerts as any);
    await controller.update('11111111-1111-1111-1111-111111111111', { fee_percent: 0.02 } as any, 'admin-1');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'admin-1', action: 'wallet_limit_updated', entity_type: 'wallet_limit',
      changes: expect.objectContaining({ op_type: 'WITHDRAWAL', currency: 'CDF' }),
    }));
    expect(alerts.alert).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warning' }));
  });
});
