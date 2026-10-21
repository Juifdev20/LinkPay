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
  return { service: new PlatformSettingsService(fake.service, audit as any), fake, audit };
}

describe('indicative CDF/USD rate (display only)', () => {
  it('is public, with the screenshot switch', async () => {
    const { service } = setup({ screenshot_protection: true, cdf_per_usd: '2850.00' });
    expect(await service.getPublicSettings()).toEqual({ screenshot_protection: true, cdf_per_usd: 2850 });
  });

  it('before migration 072: no rate, nothing breaks', async () => {
    const { service } = setup({ screenshot_protection: false }, { missingRateColumn: true });
    expect(await service.getPublicSettings()).toEqual({ screenshot_protection: false, cdf_per_usd: null });
  });

  it('changing the rate keeps the screenshot switch as it was, and is audited', async () => {
    const { service, fake, audit } = setup({ screenshot_protection: true, cdf_per_usd: null });
    await service.update('admin-1', { cdf_per_usd: 2900 });
    const upsert = fake.queries.find((q) => q.calls.some((c) => c.method === 'upsert'))!.calls.find((c) => c.method === 'upsert')!.args[0];
    expect(upsert).toMatchObject({ screenshot_protection: true, cdf_per_usd: 2900 });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'indicative_rate_changed', changes: { from: null, to: 2900 } }));
  });
});
