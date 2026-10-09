import { HttpException } from '@nestjs/common';
import { MAX_OUTFLOW_OPS_PER_HOUR, RiskService } from './risk.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

function setup(opts: { transfers?: any[]; withdrawals?: any[]; walletCreatedAt?: string; failRead?: boolean } = {}) {
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (opts.failRead && q.target === 'transfers') throw new Error('db down');
    if (q.target === 'transfers') return { data: opts.transfers ?? [] };
    if (q.target === 'withdrawals') return { data: opts.withdrawals ?? [] };
    if (q.target === 'wallets') return { data: { created_at: opts.walletCreatedAt ?? ago(30 * 24 * 3_600_000) } };
    return { data: null };
  });
  const alerts = { alert: jest.fn(async () => undefined) };
  return { service: new RiskService(fake.service, alerts as any), fake, alerts };
}

const base = { userId: 'u1', walletId: 'w1', currency: 'CDF' };
const logged = (fake: any) => fake.queries.filter((q: RecordedQuery) => q.target === 'risk_logs');

describe('RiskService.assessOutflow', () => {
  it('lets an ordinary operation through without logging anything', async () => {
    const { service, fake } = setup({ transfers: [{ recipient_wallet_id: 'a', created_at: ago(1000) }] });
    await expect(service.assessOutflow({ ...base, kind: 'TRANSFER', amountCents: 100_000, recipientWalletId: 'b' })).resolves.toBeUndefined();
    expect(logged(fake)).toHaveLength(0);
  });

  it('blocks and logs a wallet that already made too many operations this hour', async () => {
    const transfers = Array.from({ length: MAX_OUTFLOW_OPS_PER_HOUR }, (_, i) => ({ recipient_wallet_id: `r${i % 2}`, created_at: ago(30 * 60_000) }));
    const { service, fake, alerts } = setup({ transfers });
    const err: any = await service.assessOutflow({ ...base, kind: 'WITHDRAWAL', amountCents: 100_000 }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(429);
    expect(logged(fake)).toHaveLength(1);
    expect(alerts.alert).toHaveBeenCalledWith(expect.objectContaining({ severity: 'critical', audience: 'admins' }));
  });

  it('blocks sending to a sixth different wallet within ten minutes, but not to one already used', async () => {
    const transfers = ['a', 'b', 'c', 'd', 'e'].map((r) => ({ recipient_wallet_id: r, created_at: ago(60_000) }));
    const { service } = setup({ transfers });
    await expect(service.assessOutflow({ ...base, kind: 'TRANSFER', amountCents: 1000, recipientWalletId: 'f' })).rejects.toBeInstanceOf(HttpException);
    await expect(service.assessOutflow({ ...base, kind: 'TRANSFER', amountCents: 1000, recipientWalletId: 'a' })).resolves.toBeUndefined();
  });

  it('blocks a large withdrawal from a wallet created minutes ago', async () => {
    const { service } = setup({ walletCreatedAt: ago(5 * 60_000) });
    await expect(service.assessOutflow({ ...base, kind: 'WITHDRAWAL', amountCents: 60_000_000 })).rejects.toBeInstanceOf(HttpException);
    await expect(service.assessOutflow({ ...base, kind: 'WITHDRAWAL', amountCents: 1_000_000 })).resolves.toBeUndefined();
  });

  it('only logs (does not block) a very large operation from an established wallet', async () => {
    const { service, fake } = setup();
    await expect(service.assessOutflow({ ...base, kind: 'WITHDRAWAL', amountCents: 250_000_000 })).resolves.toBeUndefined();
    expect(logged(fake)).toHaveLength(1);
  });

  it('lets the operation through if the history cannot be read (other defences still apply)', async () => {
    const { service } = setup({ failRead: true });
    await expect(service.assessOutflow({ ...base, kind: 'WITHDRAWAL', amountCents: 100 })).resolves.toBeUndefined();
  });
});
