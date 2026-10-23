import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SupplierPlanService } from './supplier-plan.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

const DAY = 86_400_000;

function setup(opts: { settings?: any; prices?: any[]; owner?: string } = {}) {
  const rpc: any[] = [];
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'supplier_plan_settings') return { data: opts.settings ?? { trial_days: 3, annual_free_months: 2, reminder_days: [7, 3, 1] } };
    if (q.target === 'supplier_plan_prices') return { data: opts.prices ?? [{ currency: 'USD', price_month_cents: 1000 }] };
    if (q.target === 'organizations') return { data: { id: 'org1', owner_id: opts.owner ?? 'boss' } };
    if (q.target === 'rpc:purchase_supplier_plan') { rpc.push(q.calls[0].args[0]); return { data: [{ expires_at: '2027-10-23T00:00:00Z' }] }; }
    return { data: null };
  });
  const pins = { verifyPin: jest.fn(async () => undefined) };
  const wallets = { getWalletByUserId: jest.fn(async () => ({ id: 'w1', status: 'ACTIVE' })) };
  const notifications = { create: jest.fn(async () => undefined) };
  const audit = { log: jest.fn(async () => undefined) };
  return { service: new SupplierPlanService(fake.service, notifications as any, audit as any, wallets as any, pins as any), rpc, pins };
}

describe('Fournisseur plan (trial, monthly, annual — all set by the super admin)', () => {
  it('the year costs (12 − N) months, N set by the super admin; monthly is N × the price', async () => {
    const { service } = setup();
    await expect(service.quote({ plan: 'annual', currency: 'USD' })).resolves.toMatchObject({ months: 12, months_charged: 10, amount_cents: 10000 });
    await expect(service.quote({ plan: 'monthly', months: 3, currency: 'USD' })).resolves.toMatchObject({ months: 3, months_charged: 3, amount_cents: 3000 });
    await expect(setup({ settings: { trial_days: 30, annual_free_months: 0, reminder_days: [] } }).service.quote({ plan: 'annual', currency: 'USD' }))
      .resolves.toMatchObject({ amount_cents: 12000 });
  });

  it('a currency without a price is not on sale', async () => {
    await expect(setup().service.quote({ plan: 'monthly', months: 1, currency: 'CDF' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('trial → expired, and a paid plan → active; only trial and active take orders', () => {
    const { service } = setup();
    const now = Date.now();
    expect(service.stateOf({ trial_ends_at: new Date(now + 2.5 * DAY).toISOString() }, now)).toMatchObject({ status: 'trial', can_sell: true, trial_days_left: 3 });
    expect(service.stateOf({ trial_ends_at: new Date(now - DAY).toISOString() }, now)).toMatchObject({ status: 'expired', can_sell: false });
    expect(service.stateOf({ trial_ends_at: new Date(now - DAY).toISOString(), plan_expires_at: new Date(now + 10 * DAY).toISOString() }, now))
      .toMatchObject({ status: 'active', can_sell: true, plan_days_left: 10 });
    expect(() => service.assertCanSell({ trial_ends_at: new Date(now - DAY).toISOString() })).toThrow(ForbiddenException);
  });

  it('only the owner pays, with the PIN; the amount comes from the admin prices, never from the request', async () => {
    const { service, rpc, pins } = setup();
    await service.subscribe('boss', 'org1', { plan: 'annual', currency: 'USD', pin: '1234' }, 'key-1');
    expect(pins.verifyPin).toHaveBeenCalledWith('boss', '1234');
    expect(rpc[0]).toMatchObject({ p_org: 'org1', p_user: 'boss', p_wallet: 'w1', p_plan: 'annual', p_months: 12, p_months_charged: 10, p_amount: 10000, p_currency: 'USD' });
    await expect(setup().service.subscribe('manager', 'org1', { plan: 'monthly', months: 1, currency: 'USD', pin: '1234' }, 'k')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
