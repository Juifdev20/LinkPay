import { PlatformSettingsService } from './platform-settings.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

function setup(row: any, opts: { missingRateColumn?: boolean } = {}) {
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target !== 'platform_settings') return undefined;
    const sel = q.calls.find((c) => c.method === 'select')?.args[0] || '';
    if (opts.missingRateColumn && String(sel).includes('cdf_per_usd')) return { error: { message: 'column platform_settings.cdf_per_usd does not exist' } };
    if (q.calls.some((c) => c.method === 'upsert')) return { data: q.calls.find((c) => c.method === 'upsert')!.args[0] };
    return { data: row };
  });
  const audit = { log: jest.fn(async () => undefined) };
  const twoFactor = { forgetAdminPause: jest.fn() };
  const alerts = { alert: jest.fn(async () => undefined) };
  return { service: new PlatformSettingsService(fake.service, audit as any, twoFactor as any, alerts as any), fake, audit, twoFactor, alerts };
}

describe('indicative CDF/USD rate (display only)', () => {
  it('is public, with the screenshot switch', async () => {
    const { service } = setup({ screenshot_protection: true, cdf_per_usd: '2850.00' });
    expect(await service.getPublicSettings()).toMatchObject({ screenshot_protection: true, cdf_per_usd: 2850 });
  });

  it('before migration 072: no rate, nothing breaks', async () => {
    const { service } = setup({ screenshot_protection: false }, { missingRateColumn: true });
    expect(await service.getPublicSettings()).toMatchObject({ screenshot_protection: false, cdf_per_usd: null });
  });

  it('changing the rate keeps the screenshot switch as it was, and is audited', async () => {
    const { service, fake, audit } = setup({ screenshot_protection: true, cdf_per_usd: null });
    await service.update('admin-1', { cdf_per_usd: 2900 });
    const upsert = fake.queries.find((q) => q.calls.some((c) => c.method === 'upsert'))!.calls.find((c) => c.method === 'upsert')!.args[0];
    expect(upsert).toMatchObject({ screenshot_protection: true, cdf_per_usd: 2900 });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'indicative_rate_changed', changes: { from: null, to: 2900 } }));
  });
});

describe('support contacts (set by the super admin, migration 080)', () => {
  it('are public, and absent ones read as null', async () => {
    const { service } = setup({ screenshot_protection: false, support_phone: '+243 812 345 678', support_email: 'aide@exemple.cd' });
    expect((await service.getPublicSettings()).support).toEqual({ phone: '+243 812 345 678', whatsapp: null, email: 'aide@exemple.cd' });
  });

  it('before migration 080: no contacts, nothing breaks', async () => {
    const { service } = setup({ screenshot_protection: true });
    expect((await service.getPublicSettings()).support).toEqual({ phone: null, whatsapp: null, email: null });
  });

  it('are trimmed, an emptied one is removed, the others stay as they were, and the change is audited', async () => {
    const { service, fake, audit } = setup({ screenshot_protection: true, support_phone: '0812345678', support_email: 'old@exemple.cd' });
    await service.update('admin-1', { support_phone: '  +243  812 345 678 ', support_email: '' });
    const upsert = fake.queries.find((q) => q.calls.some((c) => c.method === 'upsert'))!.calls.find((c) => c.method === 'upsert')!.args[0];
    expect(upsert).toMatchObject({ screenshot_protection: true, support_phone: '+243 812 345 678', support_email: null });
    expect(upsert).not.toHaveProperty('support_whatsapp');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'support_contacts_changed',
      changes: { support_phone: { from: '0812345678', to: '+243 812 345 678' }, support_email: { from: 'old@exemple.cd', to: null } },
    }));
  });
});

describe("suspending the administrators' second factor (migration 081)", () => {
  const upsertOf = (fake: any) => fake.queries.find((q: RecordedQuery) => q.calls.some((c) => c.method === 'upsert'))!.calls.find((c: any) => c.method === 'upsert')!.args[0];

  it('for a while: until the date, by whom, audited, every super admin alerted, this server sees it at once', async () => {
    const { service, fake, audit, twoFactor, alerts } = setup({ screenshot_protection: false });
    const before = Date.now();
    await service.setAdminTwoFactorPause('sa-1', 24);
    const upsert = upsertOf(fake);
    const until = new Date(upsert.admin_2fa_paused_until).getTime();
    expect(until).toBeGreaterThanOrEqual(before + 24 * 3600_000);
    expect(until).toBeLessThan(before + 24 * 3600_000 + 60_000);
    expect(upsert.admin_2fa_paused_by).toBe('sa-1');
    expect(upsert).not.toHaveProperty('screenshot_protection');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin_2fa_paused' }));
    expect(alerts.alert).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warning', title: expect.stringContaining('suspendue') }));
    expect(twoFactor.forgetAdminPause).toHaveBeenCalled();
  });

  it('back on: the date is cleared', async () => {
    const { service, fake, audit, alerts } = setup({ admin_2fa_paused_until: new Date(Date.now() + 3600_000).toISOString() });
    await service.setAdminTwoFactorPause('sa-1', 0);
    expect(upsertOf(fake)).toMatchObject({ admin_2fa_paused_until: null, admin_2fa_paused_by: null });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin_2fa_resumed' }));
    expect(alerts.alert).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('réactivée') }));
  });

  it('a date already passed reads as "required"', async () => {
    const { service } = setup({ admin_2fa_paused_until: new Date(Date.now() - 1000).toISOString() });
    expect((await service.getSettings()).admin_2fa_paused_until).toBeNull();
  });
});
