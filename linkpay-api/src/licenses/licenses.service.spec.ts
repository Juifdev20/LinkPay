import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';
import { LicensesService } from './licenses.service';
import { LicenseGuard } from './license.guard';

const DAY = 86_400_000;
const NOW = Date.parse('2026-06-15T10:00:00Z');

const FEATURES = [
  { key: 'pos', name: 'Caisse', description: null, sort_order: 1, is_active: true },
  { key: 'stock', name: 'Stock', description: null, sort_order: 2, is_active: true },
];
const PRICES = [
  { feature_key: 'pos', currency: 'CDF', price_per_day_cents: 1000 },
  { feature_key: 'stock', currency: 'CDF', price_per_day_cents: 500 },
];

function setup(opts: {
  validatedAt?: string;
  licenses?: { feature_key: string; expires_at: string }[];
  settings?: any;
  bundle?: any[];
  rpc?: (args: any) => any;
  ownerId?: string;
} = {}) {
  const writes: RecordedQuery[] = [];
  const fake = createFakeSupabase((q) => {
    if (q.target.startsWith('rpc:')) return opts.rpc ? opts.rpc(q.calls[0].args[0]) : { data: [] };
    const isSingle = q.calls.some((c) => c.method === 'maybeSingle' || c.method === 'single');
    switch (q.target) {
      case 'license_settings':
        return { data: opts.settings ?? { trial_days: 30, trial_end_mode: 'read_only', expiry_mode: 'blocked', reminder_days: [7, 3, 1] } };
      case 'license_features': return { data: FEATURES };
      case 'license_feature_prices': return { data: PRICES };
      case 'license_bundle_prices': return { data: opts.bundle ?? [] };
      case 'organizations':
        return { data: isSingle ? { id: 'org1', owner_id: opts.ownerId ?? 'boss', name: 'Shop', validated_at: opts.validatedAt ?? '2026-06-01T00:00:00Z', created_at: '2026-06-01T00:00:00Z' } : [] };
      case 'organization_licenses':
        if (q.calls.some((c) => c.method === 'update')) writes.push(q);
        return { data: opts.licenses ?? [] };
      default: return { data: [] };
    }
  });
  const notifications = { create: jest.fn().mockResolvedValue(undefined) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const wallets = { getWalletByUserId: jest.fn().mockResolvedValue({ id: 'w1', status: 'ACTIVE' }) };
  const pins = { verifyPin: jest.fn().mockResolvedValue(undefined) };
  const service = new LicensesService(fake.service, notifications as any, audit as any, wallets as any, pins as any);
  return { service, fake, notifications, audit, wallets, pins, writes };
}

describe('LicensesService.getState', () => {
  it('everything is usable during the trial', async () => {
    const { service } = setup();
    const s = await service.getState('org1', NOW);
    expect(s.trial.active).toBe(true);
    expect(s.trial.days_left).toBe(16);
    expect(s.features.map((f) => f.status)).toEqual(['trial', 'trial']);
  });

  it('a feature has no licence after the trial, active with a running licence, expired after it ends', async () => {
    const late = NOW + 40 * DAY;
    const { service } = setup({ licenses: [{ feature_key: 'pos', expires_at: new Date(late + 3 * DAY).toISOString() }, { feature_key: 'stock', expires_at: new Date(late - DAY).toISOString() }] });
    const s = await service.getState('org1', late);
    expect(s.trial.active).toBe(false);
    const by = Object.fromEntries(s.features.map((f) => [f.key, f]));
    expect(by.pos).toMatchObject({ status: 'active', days_left: 3 });
    expect(by.stock).toMatchObject({ status: 'expired', mode: 'blocked' });
  });

  it('uses "none" with the trial-end mode when nothing was ever bought', async () => {
    const { service } = setup();
    const s = await service.getState('org1', NOW + 60 * DAY);
    expect(s.features[0]).toMatchObject({ status: 'none', mode: 'read_only' });
  });
});

describe('LicensesService.assertAccess', () => {
  it('lets everything through during the trial', async () => {
    const { service } = setup({ validatedAt: new Date(Date.now() - 2 * DAY).toISOString() });
    await expect(service.assertAccess('org1', 'pos', true)).resolves.toBeUndefined();
  });

  it('read_only: reading passes, writing is refused with LICENSE_REQUIRED', async () => {
    const { service } = setup({ validatedAt: '2026-01-01T00:00:00Z' });
    await expect(service.assertAccess('org1', 'pos', false)).resolves.toBeUndefined();
    const err: any = await service.assertAccess('org1', 'pos', true).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse()).toMatchObject({ code: 'LICENSE_REQUIRED', feature: 'pos', reason: 'none', mode: 'read_only' });
    expect(err.getResponse().message).toContain("Vous n'avez pas de licence");
  });

  it('blocked: even reading is refused, and an expired licence says so', async () => {
    const { service } = setup({
      validatedAt: '2026-01-01T00:00:00Z',
      licenses: [{ feature_key: 'stock', expires_at: new Date(Date.now() - DAY).toISOString() }],
    });
    const err: any = await service.assertAccess('org1', 'stock', false).catch((e) => e);
    expect(err.getResponse()).toMatchObject({ code: 'LICENSE_REQUIRED', reason: 'expired', mode: 'blocked' });
  });

  it('never takes a business offline when the licence tables are unreadable', async () => {
    const { service } = setup();
    jest.spyOn(service, 'getState').mockRejectedValue(new Error('relation does not exist'));
    await expect(service.assertAccess('org1', 'pos', true)).resolves.toBeUndefined();
  });
});

describe('LicensesService.quote', () => {
  it('sums the chosen features by the day', async () => {
    const { service } = setup();
    const q = await service.quote({ features: ['pos', 'stock'], days: 10, currency: 'CDF' });
    expect(q).toMatchObject({ per_day_cents: 1500, amount_cents: 15000, is_bundle: false });
  });

  it('"everything" uses the admin\'s bundle price when there is one', async () => {
    const { service } = setup({ bundle: [{ currency: 'CDF', price_per_day_cents: 1200 }] });
    const q = await service.quote({ all: true, days: 5, currency: 'CDF' });
    expect(q).toMatchObject({ is_bundle: true, per_day_cents: 1200, amount_cents: 6000, features: ['pos', 'stock'] });
  });

  it('"everything" without a bundle price is the sum', async () => {
    const { service } = setup();
    expect(await service.quote({ all: true, days: 1, currency: 'CDF' })).toMatchObject({ is_bundle: false, amount_cents: 1500 });
  });

  it('refuses nothing chosen, unknown features, bad days, unpriced currency', async () => {
    const { service } = setup();
    await expect(service.quote({ features: [], days: 1, currency: 'CDF' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.quote({ features: ['nope'], days: 1, currency: 'CDF' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.quote({ features: ['pos'], days: 0, currency: 'CDF' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.quote({ features: ['pos'], days: 1.5, currency: 'CDF' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.quote({ features: ['pos'], days: 99999, currency: 'CDF' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.quote({ features: ['pos'], days: 1, currency: 'USD' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('LicensesService.purchase', () => {
  const input = { features: ['pos'], days: 3, currency: 'CDF', pin: '1234' };

  it('only the owner can buy, and nothing is charged otherwise', async () => {
    const { service, fake } = setup({ ownerId: 'someone-else' });
    await expect(service.purchase('boss', 'org1', input, 'k1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(fake.queries.some((q) => q.target === 'rpc:purchase_license')).toBe(false);
  });

  it('checks the PIN, then charges the server-computed amount, idempotently keyed', async () => {
    const { service, fake, pins, audit, notifications } = setup({ rpc: () => ({ data: [{ feature_key: 'pos', expires_at: '2026-07-01T00:00:00Z' }] }) });
    await service.purchase('boss', 'org1', { ...input, amount_cents: 1 } as any, 'k1');
    expect(pins.verifyPin).toHaveBeenCalledWith('boss', '1234');
    const call = fake.queries.find((q) => q.target === 'rpc:purchase_license')!.calls[0].args[0];
    expect(call).toMatchObject({ p_org: 'org1', p_user: 'boss', p_wallet: 'w1', p_features: ['pos'], p_days: 3, p_amount: 3000, p_reference: 'lic:org1:k1' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'license_purchased' }));
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'license', user_id: 'boss' }));
  });

  it('wrong PIN: nothing is charged', async () => {
    const { service, fake, pins } = setup();
    pins.verifyPin.mockRejectedValue(new ForbiddenException('PIN incorrect'));
    await expect(service.purchase('boss', 'org1', input, 'k1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(fake.queries.some((q) => q.target === 'rpc:purchase_license')).toBe(false);
  });

  it('turns an insufficient balance into a clear message', async () => {
    const { service } = setup({ rpc: () => ({ error: { message: 'Insufficient balance' } }) });
    await expect(service.purchase('boss', 'org1', input, 'k1')).rejects.toThrow(/Solde insuffisant/);
  });

  it('requires an idempotency key', async () => {
    const { service } = setup();
    await expect(service.purchase('boss', 'org1', input, '')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('LicensesService.sendReminders', () => {
  it('announces a threshold once, then again after it is re-armed', async () => {
    const soon = new Date(NOW + 2 * DAY).toISOString();
    const { service, notifications, writes } = setup({ licenses: [{ feature_key: 'pos', expires_at: soon, last_reminder_days: null } as any], validatedAt: '2026-06-01T00:00:00Z' });
    await service.sendReminders(NOW);
    const licenceNotes = notifications.create.mock.calls.filter(([n]) => !n.data?.trial);
    expect(licenceNotes).toHaveLength(1);
    expect(licenceNotes[0][0]).toMatchObject({ user_id: 'boss', type: 'license' });
    expect(writes[0].calls.find((c) => c.method === 'update')!.args[0]).toEqual({ last_reminder_days: 3 });
  });

  it('does not repeat a threshold already sent', async () => {
    const soon = new Date(NOW + 2 * DAY).toISOString();
    const { service, notifications } = setup({ licenses: [{ feature_key: 'pos', expires_at: soon, last_reminder_days: 3 } as any] });
    await service.sendReminders(NOW);
    expect(notifications.create.mock.calls.filter(([n]) => !n.data?.trial)).toHaveLength(0);
  });

  it('tells the owner when a licence has expired, once', async () => {
    const gone = new Date(NOW - DAY).toISOString();
    const { service, notifications } = setup({ licenses: [{ feature_key: 'pos', expires_at: gone, last_reminder_days: 1 } as any] });
    await service.sendReminders(NOW);
    expect(notifications.create.mock.calls.filter(([n]) => !n.data?.trial)[0][0].title).toBe('Licence expirée');
  });
});

describe('LicenseGuard', () => {
  const ctx = (user: any, params: any, method = 'POST') =>
    ({ getHandler: () => 'h', getClass: () => 'c', switchToHttp: () => ({ getRequest: () => ({ user, params, method }) }) }) as any;
  const make = (meta: any) => {
    const licenses = { assertAccess: jest.fn().mockResolvedValue(undefined), organizationOfMerchant: jest.fn().mockResolvedValue('orgM') };
    const guard = new LicenseGuard({ getAllAndOverride: () => meta } as any, licenses as any);
    return { guard, licenses };
  };

  it('org scope uses :id directly and flags writes', async () => {
    const { guard, licenses } = make({ feature: 'sales', scope: 'org' });
    await guard.canActivate(ctx({ role: 'enterprise' }, { id: 'o1' }, 'POST'));
    expect(licenses.assertAccess).toHaveBeenCalledWith('o1', 'sales', true);
    await guard.canActivate(ctx({ role: 'enterprise' }, { id: 'o1' }, 'GET'));
    expect(licenses.assertAccess).toHaveBeenLastCalledWith('o1', 'sales', false);
  });

  it('merchant scope resolves the business of the store; a plain merchant is not licensed', async () => {
    const { guard, licenses } = make({ feature: 'pos', scope: 'merchant' });
    await guard.canActivate(ctx({ role: 'caissier' }, { id: 'm1' }));
    expect(licenses.assertAccess).toHaveBeenCalledWith('orgM', 'pos', true);
    licenses.organizationOfMerchant.mockResolvedValue(null);
    licenses.assertAccess.mockClear();
    await guard.canActivate(ctx({ role: 'merchant' }, { id: 'm2' }));
    expect(licenses.assertAccess).not.toHaveBeenCalled();
  });

  it('administrators bypass, unmarked routes pass', async () => {
    const { guard, licenses } = make({ feature: 'pos', scope: 'org' });
    await guard.canActivate(ctx({ role: 'super_admin' }, { id: 'o1' }));
    expect(licenses.assertAccess).not.toHaveBeenCalled();
    const none = make(undefined);
    expect(await none.guard.canActivate(ctx({ role: 'enterprise' }, { id: 'o1' }))).toBe(true);
  });
});
