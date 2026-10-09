import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionGuard } from './subscription.guard';

const DAY = 86_400_000;
const NOW = Date.parse('2026-06-15T10:00:00Z');

function setup(opts: {
  validatedAt?: string;
  expiresAt?: string | null;
  lastReminder?: number | null;
  trialLastReminder?: number | null;
  settings?: any;
  prices?: Record<string, number>;
  rpc?: (args: any) => any;
  ownerId?: string;
} = {}) {
  const writes: RecordedQuery[] = [];
  const prices = opts.prices ?? { CDF: 1_500_000, USD: 1000 };
  const validatedAt = opts.validatedAt ?? '2026-06-01T00:00:00Z';
  const fake = createFakeSupabase((q) => {
    if (q.target.startsWith('rpc:')) return opts.rpc ? opts.rpc(q.calls[0].args[0]) : { data: [] };
    const isSingle = q.calls.some((c) => c.method === 'maybeSingle' || c.method === 'single');
    switch (q.target) {
      case 'subscription_settings':
        return { data: opts.settings ?? { trial_days: 30, trial_end_mode: 'read_only', expiry_mode: 'blocked', reminder_days: [7, 3, 1] } };
      case 'subscription_prices':
        return { data: Object.entries(prices).map(([currency, price_month_cents]) => ({ currency, price_month_cents })) };
      case 'organizations': {
        const org = { id: 'org1', owner_id: opts.ownerId ?? 'boss', name: 'Shop', validated_at: validatedAt, created_at: validatedAt };
        return { data: isSingle ? org : [org] };
      }
      case 'organization_subscriptions': {
        if (q.calls.some((c) => c.method === 'update' || c.method === 'upsert')) writes.push(q);
        const row = { organization_id: 'org1', expires_at: opts.expiresAt ?? null, last_reminder_days: opts.lastReminder ?? null, trial_last_reminder_days: opts.trialLastReminder ?? null };
        const has = opts.expiresAt !== undefined && opts.expiresAt !== null || opts.trialLastReminder !== undefined;
        return { data: isSingle ? (opts.expiresAt ? row : null) : has || opts.expiresAt ? [row] : [] };
      }
      default: return { data: [] };
    }
  });
  const notifications = { create: jest.fn().mockResolvedValue(undefined) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const wallets = { getWalletByUserId: jest.fn().mockResolvedValue({ id: 'w1', status: 'ACTIVE' }) };
  const pins = { verifyPin: jest.fn().mockResolvedValue(undefined) };
  const service = new SubscriptionsService(fake.service, notifications as any, audit as any, wallets as any, pins as any);
  return { service, fake, notifications, audit, wallets, pins, writes };
}

describe('SubscriptionsService.getState', () => {
  it('everything is usable during the trial', async () => {
    const { service } = setup();
    const s = await service.getState('org1', NOW);
    expect(s).toMatchObject({ status: 'trial', expires_at: null });
    expect(s.trial).toMatchObject({ active: true, days_left: 16 });
    expect(s.prices).toEqual({ CDF: 1_500_000, USD: 1000 });
  });

  it('is "none" once the trial is over and nothing was ever paid, with the trial-end mode', async () => {
    const { service } = setup();
    expect(await service.getState('org1', NOW + 60 * DAY)).toMatchObject({ status: 'none', mode: 'read_only' });
  });

  it('is "active" while paid, whatever the trial says', async () => {
    const at = NOW + 60 * DAY;
    const { service } = setup({ expiresAt: new Date(at + 3 * DAY).toISOString() });
    expect(await service.getState('org1', at)).toMatchObject({ status: 'active', days_left: 3 });
  });

  it('is "expired" after the end, with the expiry mode', async () => {
    const at = NOW + 60 * DAY;
    const { service } = setup({ expiresAt: new Date(at - DAY).toISOString() });
    expect(await service.getState('org1', at)).toMatchObject({ status: 'expired', mode: 'blocked' });
  });
});

describe('SubscriptionsService.assertAccess', () => {
  const longAgo = '2026-01-01T00:00:00Z';

  it('lets everything through during the trial', async () => {
    const { service } = setup({ validatedAt: new Date(Date.now() - 2 * DAY).toISOString() });
    await expect(service.assertAccess('org1', true)).resolves.toBeUndefined();
  });

  it('read_only: reading passes, writing is refused with SUBSCRIPTION_REQUIRED', async () => {
    const { service } = setup({ validatedAt: longAgo });
    await expect(service.assertAccess('org1', false)).resolves.toBeUndefined();
    const err: any = await service.assertAccess('org1', true).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse()).toMatchObject({ code: 'SUBSCRIPTION_REQUIRED', reason: 'none', mode: 'read_only' });
    expect(err.getResponse().message).toContain("Vous n'avez pas d'abonnement actif");
  });

  it('blocked: even reading is refused, and an expired subscription says so', async () => {
    const { service } = setup({ validatedAt: longAgo, expiresAt: new Date(Date.now() - DAY).toISOString() });
    const err: any = await service.assertAccess('org1', false).catch((e) => e);
    expect(err.getResponse()).toMatchObject({ code: 'SUBSCRIPTION_REQUIRED', reason: 'expired', mode: 'blocked' });
  });

  it('a running subscription always passes', async () => {
    const { service } = setup({ validatedAt: longAgo, expiresAt: new Date(Date.now() + 5 * DAY).toISOString() });
    await expect(service.assertAccess('org1', true)).resolves.toBeUndefined();
  });

  it('never takes a business offline when the subscription tables are unreadable', async () => {
    const { service } = setup();
    jest.spyOn(service, 'getState').mockRejectedValue(new Error('relation does not exist'));
    await expect(service.assertAccess('org1', true)).resolves.toBeUndefined();
  });
});

describe('SubscriptionsService.quote', () => {
  it('multiplies the monthly price by the months', async () => {
    const { service } = setup();
    expect(await service.quote({ months: 3, currency: 'CDF' })).toMatchObject({ price_month_cents: 1_500_000, amount_cents: 4_500_000 });
  });

  it('refuses bad months, an unknown currency and a currency with no price', async () => {
    const { service } = setup({ prices: { CDF: 1_500_000 } });
    for (const months of [0, 25, 1.5, -1]) {
      await expect(service.quote({ months, currency: 'CDF' })).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(service.quote({ months: 1, currency: 'EUR' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.quote({ months: 1, currency: 'USD' })).rejects.toThrow(/pas encore en vente/);
  });
});

describe('SubscriptionsService.subscribe', () => {
  const input = { months: 2, currency: 'CDF', pin: '1234' };

  it('only the owner can pay, and nothing is charged otherwise', async () => {
    const { service, fake } = setup({ ownerId: 'someone-else' });
    await expect(service.subscribe('boss', 'org1', input, 'k1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(fake.queries.some((q) => q.target === 'rpc:purchase_subscription')).toBe(false);
  });

  it('checks the PIN, then charges the server-computed amount under an idempotent reference', async () => {
    const { service, fake, pins, audit, notifications } = setup({ rpc: () => ({ data: [{ expires_at: '2026-08-15T00:00:00Z' }] }) });
    const res = await service.subscribe('boss', 'org1', { ...input, amount_cents: 1 } as any, 'k1');
    expect(pins.verifyPin).toHaveBeenCalledWith('boss', '1234');
    const call = fake.queries.find((q) => q.target === 'rpc:purchase_subscription')!.calls[0].args[0];
    expect(call).toMatchObject({ p_org: 'org1', p_user: 'boss', p_wallet: 'w1', p_months: 2, p_currency: 'CDF', p_amount: 3_000_000, p_reference: 'sub:org1:k1' });
    expect(res.expires_at).toBe('2026-08-15T00:00:00Z');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'subscription_paid' }));
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'subscription', user_id: 'boss' }));
  });

  it('wrong PIN: nothing is charged', async () => {
    const { service, fake, pins } = setup();
    pins.verifyPin.mockRejectedValue(new ForbiddenException('PIN incorrect'));
    await expect(service.subscribe('boss', 'org1', input, 'k1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(fake.queries.some((q) => q.target === 'rpc:purchase_subscription')).toBe(false);
  });

  it('turns an insufficient balance into a clear message', async () => {
    const { service } = setup({ rpc: () => ({ error: { message: 'Insufficient balance' } }) });
    await expect(service.subscribe('boss', 'org1', input, 'k1')).rejects.toThrow(/Solde insuffisant/);
  });

  it('requires an idempotency key', async () => {
    const { service } = setup();
    await expect(service.subscribe('boss', 'org1', input, '')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('SubscriptionsService.sendReminders', () => {
  const trialNotes = (n: jest.Mock) => n.mock.calls.filter(([x]) => x.data?.trial);
  const subNotes = (n: jest.Mock) => n.mock.calls.filter(([x]) => !x.data?.trial);

  it('warns once when the subscription is close to its end', async () => {
    const { service, notifications, writes } = setup({ expiresAt: new Date(NOW + 2 * DAY).toISOString() });
    await service.sendReminders(NOW);
    expect(subNotes(notifications.create)).toHaveLength(1);
    expect(subNotes(notifications.create)[0][0]).toMatchObject({ user_id: 'boss', type: 'subscription' });
    expect(writes[0].calls.find((c) => c.method === 'update')!.args[0]).toEqual({ last_reminder_days: 3 });
    expect(trialNotes(notifications.create)).toHaveLength(0); // paying customers get no trial notice
  });

  it('does not repeat a threshold already sent', async () => {
    const { service, notifications } = setup({ expiresAt: new Date(NOW + 2 * DAY).toISOString(), lastReminder: 3 });
    await service.sendReminders(NOW);
    expect(subNotes(notifications.create)).toHaveLength(0);
  });

  it('tells the owner once when the subscription has expired', async () => {
    const { service, notifications } = setup({ expiresAt: new Date(NOW - DAY).toISOString(), lastReminder: 1 });
    await service.sendReminders(NOW);
    expect(subNotes(notifications.create)[0][0].title).toBe('Abonnement expiré');
  });

  it('warns about the end of the free trial for a business that never paid', async () => {
    const { service, notifications } = setup({ validatedAt: new Date(NOW - 28 * DAY).toISOString() });
    await service.sendReminders(NOW);
    expect(trialNotes(notifications.create)).toHaveLength(1);
    expect(trialNotes(notifications.create)[0][0].title).toContain('Essai gratuit : 3 jours');
  });
});

describe('SubscriptionGuard', () => {
  const ctx = (user: any, params: any, method = 'POST') =>
    ({ getHandler: () => 'h', getClass: () => 'c', switchToHttp: () => ({ getRequest: () => ({ user, params, method }) }) }) as any;
  const make = (meta: any) => {
    const subscriptions = { assertAccess: jest.fn().mockResolvedValue(undefined), organizationOfMerchant: jest.fn().mockResolvedValue('orgM') };
    const guard = new SubscriptionGuard({ getAllAndOverride: () => meta } as any, subscriptions as any);
    return { guard, subscriptions };
  };

  it('org scope uses :id directly and flags writes', async () => {
    const { guard, subscriptions } = make({ scope: 'org' });
    await guard.canActivate(ctx({ role: 'enterprise' }, { id: 'o1' }, 'POST'));
    expect(subscriptions.assertAccess).toHaveBeenCalledWith('o1', true);
    await guard.canActivate(ctx({ role: 'enterprise' }, { id: 'o1' }, 'GET'));
    expect(subscriptions.assertAccess).toHaveBeenLastCalledWith('o1', false);
  });

  it('merchant scope resolves the business of the store; a plain merchant is not subject', async () => {
    const { guard, subscriptions } = make({ scope: 'merchant' });
    await guard.canActivate(ctx({ role: 'caissier' }, { id: 'm1' }));
    expect(subscriptions.assertAccess).toHaveBeenCalledWith('orgM', true);
    subscriptions.organizationOfMerchant.mockResolvedValue(null);
    subscriptions.assertAccess.mockClear();
    await guard.canActivate(ctx({ role: 'merchant' }, { id: 'm2' }));
    expect(subscriptions.assertAccess).not.toHaveBeenCalled();
  });

  it('administrators bypass, unmarked routes pass', async () => {
    const { guard, subscriptions } = make({ scope: 'org' });
    await guard.canActivate(ctx({ role: 'super_admin' }, { id: 'o1' }));
    expect(subscriptions.assertAccess).not.toHaveBeenCalled();
    expect(await make(undefined).guard.canActivate(ctx({ role: 'enterprise' }, { id: 'o1' }))).toBe(true);
  });
});
