import { NotFoundException } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

function setup(roleSlugs: string[], opts: { hasWallet?: boolean } = {}) {
  let walletReads = 0;
  const upserts: any[] = [];
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'wallets') {
      if (q.calls.some((c) => c.method === 'upsert')) { upserts.push(q.calls.find((c) => c.method === 'upsert')!.args[0]); return { data: null }; }
      walletReads++;
      if (opts.hasWallet || walletReads > 1) return { data: { id: 'w1', user_id: 'emp', status: 'ACTIVE' } };
      return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    }
    if (q.target === 'user_roles') return { data: roleSlugs.map((slug) => ({ role: { slug } })) };
    return { data: null };
  });
  const service = new WalletsService(fake.service, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  return { service, upserts };
}

describe('employees have a wallet for their salary', () => {
  it('opens one on first use for an employee who has none (vendeur, caissier, magasinier, comptable…)', async () => {
    for (const role of ['vendeur', 'caissier', 'magasinier', 'comptable', 'cashier']) {
      const { service, upserts } = setup([role]);
      await expect(service.getWalletByUserId('emp')).resolves.toMatchObject({ id: 'w1' });
      expect(upserts).toEqual([{ user_id: 'emp' }]);
    }
  });

  it('returns the existing wallet without creating another', async () => {
    const { service, upserts } = setup(['vendeur'], { hasWallet: true });
    await service.getWalletByUserId('emp');
    expect(upserts).toHaveLength(0);
  });

  it('administrators still have no wallet', async () => {
    for (const role of ['admin', 'super_admin']) {
      const { service, upserts } = setup([role]);
      await expect(service.getWalletByUserId('adm')).rejects.toBeInstanceOf(NotFoundException);
      expect(upserts).toHaveLength(0);
    }
  });

  it('a user with no role at all gets none either', async () => {
    const { service } = setup([]);
    await expect(service.getWalletByUserId('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });
});
