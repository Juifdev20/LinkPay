import { BadRequestException, ConflictException } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

const WALLET = { id: 'wal1', status: 'ACTIVE', user_id: 'u1' };
const DTO = { amount_cents: 200000, currency: 'CDF', channel: 'mobile_money' as const, destination: { phone: '+243900000000' }, pin: '1234' };
const ROW = { id: 'w1', wallet_id: 'wal1', amount_cents: 200000, currency: 'CDF', fee_cents: 5000, status: 'PENDING', psp_provider: 'mock' };

function setup(opts: { rpc?: (q: RecordedQuery) => any; existing?: any; winner?: any } = {}) {
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'wallets') return { data: WALLET };
    if (q.target === 'rpc:request_withdrawal') return opts.rpc ? opts.rpc(q) : { data: ROW };
    if (q.target === 'withdrawals') {
      if (q.calls.some((c) => c.method === 'insert')) return { data: ROW };
      return { data: opts.existing ?? opts.winner ?? null };
    }
    return { data: null };
  });
  const payouts = { dispatch: jest.fn(async () => ({ withdrawal: { ...ROW, status: 'PROCESSING' } })) };
  const service = new WalletsService(
    fake.service, { get: () => ({ provider: 'mock' }) } as any, { create: jest.fn(async () => undefined) } as any, { get: (_k: string, d?: any) => d } as any,
    { verifyPin: jest.fn(async () => undefined) } as any,
    { getRule: async () => ({}), quoteFee: () => ({ fee_cents: 5000, total_cents: 205000 }), assertWithinLimits: async () => undefined } as any,
    { log: jest.fn(async () => undefined) } as any, {} as any, payouts as any, { assessOutflow: jest.fn(async () => undefined) } as any,
  );
  const called = (target: string) => fake.queries.filter((q) => q.target === target).length;
  return { service, payouts, fake, called };
}

describe('requestWithdrawal — the request and its debit are ONE database operation', () => {
  it('creates the withdrawal and takes the money with a single call (amount, fee, currency, key), and no separate insert/debit', async () => {
    const { service, fake, called } = setup();
    await service.requestWithdrawal('u1', DTO, 'key-1');
    const call = fake.queries.find((q) => q.target === 'rpc:request_withdrawal')!.calls[0].args[0];
    expect(call).toMatchObject({ p_wallet: 'wal1', p_amount: 200000, p_fee: 5000, p_currency: 'CDF', p_channel: 'mobile_money', p_psp_provider: 'mock', p_idempotency_key: 'key-1' });
    expect(called('rpc:debit_wallet')).toBe(0);
    expect(fake.queries.some((q) => q.target === 'withdrawals' && q.calls.some((c) => c.method === 'insert'))).toBe(false);
  });

  it('insufficient balance: a clear message, and nothing else is tried (no half-created withdrawal to clean up)', async () => {
    const { service, called, payouts } = setup({ rpc: () => ({ error: { message: 'Insufficient balance: has 10, needs 205000' } }) });
    await expect(service.requestWithdrawal('u1', DTO, 'key-1')).rejects.toThrow(/Solde ScanLinkPay insuffisant/);
    expect(called('rpc:debit_wallet')).toBe(0);
    expect(payouts.dispatch).not.toHaveBeenCalled();
  });

  it('an unrelated database error is NOT mistaken for "insufficient balance"', async () => {
    const { service } = setup({ rpc: () => ({ error: { message: 'connection timeout' } }) });
    const err: any = await service.requestWithdrawal('u1', DTO, 'key-1').catch((e) => e);
    expect(err).not.toBeInstanceOf(BadRequestException);
    expect(err.message).toMatch(/connection timeout/);
  });

  it('the same request arriving twice at once: the loser answers with the winner\'s withdrawal', async () => {
    const { service, payouts } = setup({ rpc: () => ({ error: { message: 'duplicate key value violates unique constraint "withdrawals_idempotency_key_key"' } }), winner: ROW });
    const res: any = await service.requestWithdrawal('u1', DTO, 'key-1');
    expect(res.withdrawal.id).toBe('w1');
    expect(payouts.dispatch).not.toHaveBeenCalled(); // the winner dispatches; the loser must not pay out twice
  });

  it('a replayed key returns the original; the key of another wallet, or with another amount, is a conflict', async () => {
    await expect(setup({ existing: ROW }).service.requestWithdrawal('u1', DTO, 'key-1')).resolves.toMatchObject({ withdrawal: { id: 'w1' } });
    await expect(setup({ existing: { ...ROW, wallet_id: 'someone-else' } }).service.requestWithdrawal('u1', DTO, 'key-1')).rejects.toBeInstanceOf(ConflictException);
    await expect(setup({ existing: { ...ROW, amount_cents: 1 } }).service.requestWithdrawal('u1', DTO, 'key-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('migration 057 not applied yet: the previous two-step flow still works', async () => {
    const { service, called } = setup({ rpc: () => ({ error: { message: 'Could not find the function public.request_withdrawal in the schema cache' } }) });
    await expect(service.requestWithdrawal('u1', DTO, 'key-1')).resolves.toBeDefined();
    expect(called('rpc:debit_wallet')).toBe(1);
  });
});
