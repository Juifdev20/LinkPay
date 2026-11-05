import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
  subError?: boolean;
  orgs?: any[];
  purchases?: any[];
} = {}) {
  const writes: RecordedQuery[] = [];
  const prices = opts.prices ?? { CDF: 1_500_000, USD: 1000 };
  const validatedAt = opts.validatedAt ?? '2026-06-01T00:00:00Z';
  const fake = createFakeSupabase((q) => {
    if (q.target.startsWith('rpc:')) return opts.rpc ? opts.rpc(q.calls[0].args[0]) : { data: [] };
    const isSingle = q.calls.some((c) => c.method === 'maybeSingle' || c.method === 'single');
    switch (q.target) {
      case 'subscription_settings':
        if (opts.subError) return { error: { message: 'relation "subscription_settings" does not exist' } };
        return { data: opts.settings ?? { trial_days: 30, trial_end_mode: 'read_only', expiry_mode: 'blocked', reminder_days: [7, 3, 1] } };
      case 'subscription_prices':
        return { data: Object.entries(prices).map(([currency, price_month_cents]) => ({ currency, price_month_cents })) };
      case 'organizations': {
        if (opts.orgs && !isSingle) return { data: opts.orgs.shift() ?? [] };
        const org = { id: 'org1', owner_id: opts.ownerId ?? 'boss', name: 'Shop', validated_at: validatedAt, created_at: validatedAt };
        return { data: isSingle ? org : [org] };
      }
      case 'organization_subscriptions': {
        if (opts.subError) return { error: { message: 'relation does not exist' } };
        if (q.calls.some((c) => c.method === 'update' || c.method === 'upsert')) writes.push(q);
        const row = { organization_id: 'org1', expires_at: opts.expiresAt ?? null, last_reminder_days: opts.lastReminder ?? null, trial_last_reminder_days: opts.trialLastReminder ?? null };
        const has = opts.expiresAt !== undefined && opts.expiresAt !== null || opts.trialLastReminder !== undefined;
        return { data: isSingle ? (opts.expiresAt ? row : null) : has || opts.expiresAt ? [row] : [] };
      }
      case 'subscription_purchases':
        return { data: opts.purchases ?? [] };
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

  it('an unknown business is not let through as if the tables were unreadable', async () => {
    const { service } = setup();
    jest.spyOn(service, 'getState').mockRejectedValue(new NotFoundException('Entreprise introuvable'));
    await expect(service.assertAccess('nope', true)).rejects.toBeInstanceOf(NotFoundException);
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

describe('SubscriptionsService — flaws found in review', () => {
  const longAgo = '2026-01-01T00:00:00Z';

  it('deployed before migration 052: unreadable tables let the request through (no business is cut off)', async () => {
    const { service } = setup({ validatedAt: longAgo, subError: true });
    await expect(service.getState('org1')).rejects.toThrow(/unreadable/);
    await expect(service.assertAccess('org1', true)).resolves.toBeUndefined();
  });

  it('a business that existed before billing started gets a full trial from the billing start date', async () => {
    const billing = new Date(NOW - 2 * DAY).toISOString();
    const { service } = setup({
      validatedAt: longAgo,
      settings: { trial_days: 30, trial_end_mode: 'read_only', expiry_mode: 'blocked', reminder_days: [7, 3, 1], billing_starts_at: billing },
    });
    const s = await service.getState('org1', NOW);
    expect(s.status).toBe('trial');
    expect(s.trial.days_left).toBe(28);
  });

  it('the owner can read the state and quote even if their token predates the business (no organization_id claim)', async () => {
    const { service } = setup();
    await expect(service.assertMember('org1', 'boss', undefined, 'enterprise')).resolves.toBeUndefined();
  });

  it('staff of the business, and admins, can; a stranger and staff of another business cannot', async () => {
    const { service } = setup();
    await expect(service.assertMember('org1', 'emp', 'org1', 'vendeur')).resolves.toBeUndefined();
    await expect(service.assertMember('org1', 'adm', undefined, 'super_admin')).resolves.toBeUndefined();
    await expect(service.assertMember('org1', 'x', undefined, 'client')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.assertMember('org1', 'emp2', 'org2', 'vendeur')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the in-memory caches cannot grow without limit (ids come from request URLs)', async () => {
    const { service } = setup();
    for (let i = 0; i < 6_000; i++) await service.organizationOfMerchant(`m-${i}`);
    expect((service as any).merchantOrg.size).toBeLessThanOrEqual(5_000);
  });

  it('a payment that went through is reported as success even if the journal or notification fails', async () => {
    const { service, audit, notifications } = setup({ rpc: () => ({ data: [{ expires_at: '2026-08-15T00:00:00Z' }] }) });
    audit.log.mockRejectedValue(new Error('audit down'));
    notifications.create.mockRejectedValue(new Error('push down'));
    await expect(service.subscribe('boss', 'org1', { months: 1, currency: 'CDF', pin: '1234' }, 'k9')).resolves.toMatchObject({ expires_at: '2026-08-15T00:00:00Z' });
  });

  it('reminders read every business, not just the first 1000', async () => {
    const mkOrg = (i: number) => ({ id: `o${i}`, owner_id: `u${i}`, validated_at: new Date(NOW - 28 * DAY).toISOString(), created_at: '2026-01-01T00:00:00Z' });
    const page1 = Array.from({ length: 1000 }, (_, i) => mkOrg(i));
    const page2 = [mkOrg(1000), mkOrg(1001)];
    const { service, notifications } = setup({ orgs: [page1, page2] });
    await service.sendReminders(NOW);
    expect(notifications.create).toHaveBeenCalledTimes(1002);
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

describe('Activation manuelle par le super admin', () => {
  const ORG = '11111111-1111-1111-1111-111111111111';

  it('active N jours : appelle la fonction atomique, prévient le patron, vide le cache', async () => {
    const calls: any[] = [];
    const { service, notifications } = setup({ rpc: (a) => { calls.push(a); return { data: [{ new_expires_at: '2026-07-15T10:00:00Z' }] }; } });
    await service.getState('org1', NOW); // remplit le cache
    const r = await service.grant('admin1', 'org1', { amount: 30, unit: 'days', reason: ' test DGI ' });
    expect(calls[0]).toEqual({ p_org: 'org1', p_admin: 'admin1', p_amount: 30, p_unit: 'days', p_reason: 'test DGI' });
    expect(r).toMatchObject({ organization_id: 'org1', expires_at: '2026-07-15T10:00:00Z' });
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'boss', type: 'subscription', title: 'Abonnement activé' }));
    expect(notifications.create.mock.calls[0][0].body).toContain('juillet 2026');
  });

  it('une erreur de la base devient un message clair', async () => {
    const { service } = setup({ rpc: () => ({ error: { message: 'GRANT_INVALID_AMOUNT' } }) });
    await expect(service.grant('admin1', 'org1', { amount: 9999, unit: 'days' })).rejects.toThrow('Durée invalide');
    const b = setup({ rpc: () => ({ error: { message: 'REVOKE_NOTHING_TO_REVOKE' } }) });
    await expect(b.service.revoke('admin1', 'org1', {})).rejects.toThrow("n'a pas d'abonnement en cours");
  });

  it('désactiver un abonnement PAYÉ demande une confirmation explicite', async () => {
    const rpc = jest.fn(() => ({ data: [{ previous_expires_at: '2026-07-01T00:00:00Z', new_expires_at: '2026-06-15T10:00:00Z' }] }));
    const { service, notifications } = setup({ purchases: [{ id: 'p1' }], rpc });
    await expect(service.revoke('admin1', 'org1', {})).rejects.toMatchObject({ response: expect.objectContaining({ code: 'ABONNEMENT_PAYE' }) });
    expect(rpc).not.toHaveBeenCalled();
    const r = await service.revoke('admin1', 'org1', { confirm_paid: true, reason: 'remboursé' });
    expect(rpc).toHaveBeenCalledWith({ p_org: 'org1', p_admin: 'admin1', p_reason: 'remboursé' });
    expect(r.previous_expires_at).toBe('2026-07-01T00:00:00Z');
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Abonnement désactivé' }));
  });

  it('un abonnement offert (sans paiement) se désactive sans confirmation', async () => {
    const rpc = jest.fn(() => ({ data: [{ previous_expires_at: '2026-07-01T00:00:00Z' }] }));
    const { service } = setup({ purchases: [], rpc });
    await service.revoke('admin1', 'org1', {});
    expect(rpc).toHaveBeenCalled();
  });

  it('la liste donne le statut de chaque entreprise', async () => {
    const orgs = [
      { id: 'a', name: 'Alpha', owner_id: 'o1', validated_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' }, // essai fini, jamais payé
      { id: 'b', name: 'Beta', owner_id: 'o2', validated_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' }, // abonnement en cours
      { id: 'c', name: 'Gamma', owner_id: 'o3', validated_at: '2026-06-10T00:00:00Z', created_at: '2026-06-10T00:00:00Z' }, // essai en cours
    ];
    const fake = createFakeSupabase((q) => {
      switch (q.target) {
        case 'organizations': return { data: orgs, count: 3 };
        case 'subscription_settings': return { data: { trial_days: 30, trial_end_mode: 'read_only', expiry_mode: 'blocked', reminder_days: [7, 3, 1] } };
        case 'subscription_prices': return { data: [] };
        case 'organization_subscriptions': return { data: [{ organization_id: 'b', expires_at: '2026-07-01T00:00:00Z' }] };
        case 'subscription_purchases': return { data: [{ organization_id: 'b', expires_at: '2026-07-01T00:00:00Z' }] };
        case 'profiles': return { data: [{ id: 'o1', full_name: 'Marie' }] };
        default: return { data: [] };
      }
    });
    const service = new SubscriptionsService(fake.service, { create: jest.fn() } as any, { log: jest.fn() } as any, {} as any, {} as any);
    const r = await service.adminOrganizations({ search: '50%_' }, NOW);
    expect(r.total).toBe(3);
    expect(r.organizations.map((o) => [o.name, o.status])).toEqual([['Alpha', 'none'], ['Beta', 'active'], ['Gamma', 'trial']]);
    expect(r.organizations[0].owner_name).toBe('Marie');
    expect(r.organizations[1]).toMatchObject({ paid_until: '2026-07-01T00:00:00Z' });
    const filtre = fake.queries.find((x) => x.target === 'organizations')!.calls.find((c) => c.method === 'ilike')!;
    expect(filtre.args[1]).toBe('%50\\%\\_%'); // % et _ du texte cherché ne sont pas des jokers
  });
});
