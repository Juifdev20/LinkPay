import { createFakeSupabase } from '../../test-utils/fake-supabase';
import { SecurityMonitorService } from '../../security/security-monitor.service';
import { MerchantWalletCreditService } from '../../payments/merchant-wallet-credit.service';
import { WithdrawalPayoutService } from '../../wallets/withdrawal-payout.service';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';

// With several API instances, a scheduled job that loses the lease must do NOTHING — no query, no alert.
describe('scheduled jobs and the job lock', () => {
  const denied = { acquire: jest.fn().mockResolvedValue(false) } as any;
  const granted = (name: string) => ({ acquire: jest.fn().mockResolvedValue(true), name }) as any;

  it('ledger monitor: skips when another instance has the lease, runs (and alerts) when it wins', async () => {
    const alert = jest.fn(async () => undefined);
    const fake = createFakeSupabase((q) => (q.target === 'rpc:negative_wallet_balances' ? { data: [{ wallet_id: 'w' }] } : { data: null }));
    expect(await new SecurityMonitorService(fake.service, { alert } as any, denied).checkLedgerIntegrity()).toBe(0);
    expect(fake.queries).toHaveLength(0);
    expect(alert).not.toHaveBeenCalled();

    const lock = granted('x');
    expect(await new SecurityMonitorService(fake.service, { alert } as any, lock).checkLedgerIntegrity()).toBe(1);
    expect(lock.acquire).toHaveBeenCalledWith('ledger-integrity', 540);
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it('merchant credit retry: skips without touching the database when the lease is taken', async () => {
    const fake = createFakeSupabase(() => ({ data: [] }));
    expect(await new MerchantWalletCreditService(fake.service, denied).retryUncredited()).toBe(0);
    expect(fake.queries).toHaveLength(0);
    const lock = granted('x');
    await new MerchantWalletCreditService(fake.service, lock).retryUncredited();
    expect(lock.acquire).toHaveBeenCalledWith('merchant-credit-retry', 50);
    expect(fake.queries.length).toBeGreaterThan(0);
  });

  it('withdrawal reconciliation: skips when the lease is taken', async () => {
    const fake = createFakeSupabase(() => ({ data: [] }));
    const service = new WithdrawalPayoutService(fake.service, { get: () => ({}) } as any, { create: jest.fn() } as any, denied);
    expect(await service.reconcile()).toBe(0);
    expect(fake.queries).toHaveLength(0);
  });

  it('subscription reminders: the daily cron notifies once across instances; direct calls are unaffected', async () => {
    const fake = createFakeSupabase(() => ({ data: [] }));
    const mk = (lock: any) => new SubscriptionsService(fake.service, { create: jest.fn() } as any, { log: jest.fn() } as any, {} as any, {} as any, lock);
    const loser = mk(denied);
    const spy = jest.spyOn(loser, 'sendReminders');
    expect(await loser.runDailyReminders()).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    const winner = mk(granted('x'));
    const spy2 = jest.spyOn(winner, 'sendReminders');
    await winner.runDailyReminders();
    expect(spy2).toHaveBeenCalledTimes(1);
  });
});
