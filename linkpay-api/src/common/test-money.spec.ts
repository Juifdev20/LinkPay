import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { assertTestMoneyStaysInTests } from './test-money';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

/** wallets: id → is_test; looked up by id or by user_id ("u-<id>"). */
function db(wallets: Record<string, boolean>, error?: string) {
  return createFakeSupabase((q: RecordedQuery) => {
    if (error) return { error: { message: error } };
    const eq = q.calls.find((c) => c.method === 'eq')!;
    const id = eq.args[0] === 'user_id' ? String(eq.args[1]).replace(/^u-/, '') : eq.args[1];
    return { data: id in wallets ? { id, is_test: wallets[id] } : null };
  }).service.getClient();
}

describe('test money stays among test wallets', () => {
  const client = db({ test: true, test2: true, real: false });

  it('real money moves freely', async () => {
    await expect(assertTestMoneyStaysInTests(client, { walletId: 'real' }, null)).resolves.toBeUndefined();
    await expect(assertTestMoneyStaysInTests(client, { walletId: 'real' }, { walletId: 'test' })).resolves.toBeUndefined();
  });

  it('test money never leaves ScanLinkPay (withdrawal)', async () => {
    await expect(assertTestMoneyStaysInTests(client, { walletId: 'test' }, null)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('test money never reaches a real wallet, nor a merchant without a wallet; it may reach another test wallet', async () => {
    await expect(assertTestMoneyStaysInTests(client, { walletId: 'test' }, { walletId: 'real' })).rejects.toThrow(/portefeuille de test/);
    await expect(assertTestMoneyStaysInTests(client, { userId: 'u-test' }, { userId: null })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(assertTestMoneyStaysInTests(client, { userId: 'u-test' }, { userId: 'u-test2' })).resolves.toBeUndefined();
  });

  it('cannot tell: refused; migration 069 not applied: no test wallet can exist yet', async () => {
    await expect(assertTestMoneyStaysInTests(db({}, 'timeout'), { walletId: 'x' }, null)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(assertTestMoneyStaysInTests(db({}, 'column wallets.is_test does not exist'), { walletId: 'x' }, null)).resolves.toBeUndefined();
  });
});
