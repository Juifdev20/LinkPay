import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { createFakeSupabase } from '../test-utils/fake-supabase';
import { BANKS } from '../wallets/bank-account';
import { BankSettingsService } from './bank-settings.service';

function setup(read: any, write: any = { data: null }) {
  const fake = createFakeSupabase((q) => (q.calls.some((c) => c.method === 'upsert') ? write : read));
  const audit = { log: jest.fn(async () => undefined) };
  return { service: new BankSettingsService(fake.service, audit as any), fake, audit };
}

describe('BankSettingsService', () => {
  it('offers the whole catalogue until the super admin chooses (nothing chosen, or column not migrated yet)', async () => {
    expect(await setup({ data: { withdrawal_banks: null } }).service.enabledBanks()).toEqual(BANKS);
    expect(await setup({ data: null, error: { message: 'column platform_settings.withdrawal_banks does not exist' } }).service.enabledBanks()).toEqual(BANKS);
  });

  it('offers only the banks switched on, in the order of the catalogue, ignoring anything unknown', async () => {
    const { service } = setup({ data: { withdrawal_banks: ['Rawbank', 'Banque inventée', 'Equity BCDC'] } });
    expect(await service.enabledBanks()).toEqual(['Equity BCDC', 'Rawbank']);
  });

  it('the admin screen shows the whole catalogue with what is on', async () => {
    const { service } = setup({ data: { withdrawal_banks: ['Rawbank'] } });
    const v = await service.adminView();
    expect(v.banks).toHaveLength(BANKS.length);
    expect(v.banks.find((b) => b.name === 'Rawbank')!.enabled).toBe(true);
    expect(v.banks.find((b) => b.name === 'Ecobank')!.enabled).toBe(false);
  });

  it('saves the choice (catalogue order) and writes it in the audit journal', async () => {
    const { service, fake, audit } = setup({ data: { withdrawal_banks: null } });
    await service.setEnabled('admin-1', ['Rawbank', 'Equity BCDC']);
    const up = fake.queries.find((q) => q.calls.some((c) => c.method === 'upsert'))!;
    expect(up.calls.find((c) => c.method === 'upsert')!.args[0]).toMatchObject({ id: 1, withdrawal_banks: ['Equity BCDC', 'Rawbank'], updated_by: 'admin-1' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'withdrawal_banks_changed', user_id: 'admin-1' }));
  });

  it('refuses an unknown bank and an empty choice', async () => {
    const { service } = setup({ data: null });
    await expect(service.setEnabled('a', ['Banque inventée'])).rejects.toThrow(BadRequestException);
    await expect(service.setEnabled('a', [])).rejects.toThrow(/au moins une banque/);
  });

  it('says what to do when the migration is missing', async () => {
    const { service } = setup({ data: null }, { error: { message: "Could not find the 'withdrawal_banks' column of 'platform_settings' in the schema cache" } });
    await expect(service.setEnabled('a', ['Rawbank'])).rejects.toThrow(ServiceUnavailableException);
  });
});
