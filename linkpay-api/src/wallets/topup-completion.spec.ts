import { completeTopupOnce } from './topup-completion';
import { createFakeSupabase, has, RecordedQuery } from '../test-utils/fake-supabase';

const log = { warn: jest.fn() };
const TOPUP = { id: 't1', wallet_id: 'w1', amount_cents: 50000, currency: 'CDF', status: 'PENDING' };

describe('completeTopupOnce — SQL function path (migration 056)', () => {
  it('reports a first completion as credited (with who and how much, for the notification)', async () => {
    const fake = createFakeSupabase((q) => (q.target === 'rpc:complete_topup' ? { data: [{ credited: true, user_id: 'u1', amount_cents: '50000', currency: 'CDF' }] } : undefined));
    expect(await completeTopupOnce(fake.service.getClient(), 't1', 'psp1', log)).toEqual({ credited: true, userId: 'u1', amountCents: 50000, currency: 'CDF' });
    expect(fake.queries[0].calls[0].args[0]).toEqual({ p_topup_id: 't1', p_psp_intent_id: 'psp1' });
  });

  it('a second or concurrent confirmation is not credited again', async () => {
    const fake = createFakeSupabase((q) => (q.target === 'rpc:complete_topup' ? { data: [{ credited: false, user_id: 'u1', amount_cents: 50000, currency: 'CDF' }] } : undefined));
    expect((await completeTopupOnce(fake.service.getClient(), 't1', undefined, log)).credited).toBe(false);
  });

  it('an unknown top-up and a database failure are errors (never a silent success)', async () => {
    const notFound = createFakeSupabase(() => ({ error: { message: 'TOPUP_NOT_FOUND' } }));
    await expect(completeTopupOnce(notFound.service.getClient(), 'x', undefined, log)).rejects.toThrow(/not found/);
    const broken = createFakeSupabase(() => ({ error: { message: 'connection reset' } }));
    await expect(completeTopupOnce(broken.service.getClient(), 't1', undefined, log)).rejects.toThrow(/connection reset/);
  });
});

describe('completeTopupOnce — fallback when the function is not installed', () => {
  const MISSING = { message: 'Could not find the function public.complete_topup in the schema cache' };
  const make = (opts: { claimed?: boolean; creditError?: boolean }) => {
    const fake = createFakeSupabase((q: RecordedQuery) => {
      if (q.target === 'rpc:complete_topup') return { error: MISSING };
      if (q.target === 'rpc:credit_wallet') return opts.creditError ? { error: { message: 'boom' } } : { data: 1 };
      if (q.target === 'wallet_topups') {
        if (has(q, 'update') && has(q, 'in', 'status', ['PENDING', 'FAILED'])) return { data: opts.claimed === false ? null : { ...TOPUP, status: 'SUCCESS' } };
        return { data: TOPUP };
      }
      if (q.target === 'wallets') return { data: { user_id: 'u1' } };
      return undefined;
    });
    return fake;
  };

  it('claims PENDING → SUCCESS first, then credits once', async () => {
    const fake = make({});
    expect(await completeTopupOnce(fake.service.getClient(), 't1', 'psp', log)).toMatchObject({ credited: true, userId: 'u1', amountCents: 50000 });
    expect(fake.queries.filter((q) => q.target === 'rpc:credit_wallet')).toHaveLength(1);
  });

  it('does nothing when someone else already claimed it (no second credit)', async () => {
    const fake = make({ claimed: false });
    expect((await completeTopupOnce(fake.service.getClient(), 't1', 'psp', log)).credited).toBe(false);
    expect(fake.queries.some((q) => q.target === 'rpc:credit_wallet')).toBe(false);
  });

  it('puts the status back to PENDING when the credit fails, so the payment is not lost', async () => {
    const fake = make({ creditError: true });
    await expect(completeTopupOnce(fake.service.getClient(), 't1', 'psp', log)).rejects.toThrow(/Failed to credit/);
    const restore = fake.queries.find((q) => q.target === 'wallet_topups' && has(q, 'update', { status: 'PENDING' } as any) || q.calls.some((c) => c.method === 'update' && c.args[0]?.status === 'PENDING'));
    expect(restore).toBeDefined();
  });
});
