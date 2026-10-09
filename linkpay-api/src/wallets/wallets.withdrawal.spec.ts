import { BadRequestException } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

const WALLET = { id: 'wal1', status: 'ACTIVE', user_id: 'u1' };
const DTO = { amount_cents: 200000, currency: 'CDF', channel: 'mobile_money' as const, destination: { operator: 'mpesa', phone: '+243900000000' }, pin: '1234' };

function setup(dispatchResult: any) {
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'wallets') return { data: WALLET };
    if (q.target === 'withdrawals') {
      const inserting = q.calls.some((c) => c.method === 'insert');
      return { data: inserting ? { id: 'w1', ...DTO, wallet_id: 'wal1', fee_cents: 5000, status: 'PENDING', psp_provider: 'mock' } : null };
    }
    return { data: null };
  });
  const payouts = { dispatch: jest.fn(async () => dispatchResult) };
  const service = new WalletsService(
    fake.service,
    { get: () => ({ provider: 'mock' }) } as any,
    { create: jest.fn(async () => undefined) } as any,
    { get: (_k: string, d?: any) => d } as any,
    { verifyPin: jest.fn(async () => undefined) } as any,
    { getRule: async () => ({}), quoteFee: () => ({ fee_cents: 5000, total_cents: 205000 }), assertWithinLimits: async () => undefined } as any,
    { log: jest.fn(async () => undefined) } as any,
    {} as any,
    payouts as any,
  );
  return { service, payouts, fake };
}

describe('WalletsService.requestWithdrawal', () => {
  it("records the provider that will send the money (not a hardcoded 'mock')", async () => {
    const { service, fake } = setup({ withdrawal: { id: 'w1', status: 'PROCESSING' } });
    await service.requestWithdrawal('u1', DTO, 'key-1');
    const insert = fake.queries.find((q) => q.target === 'withdrawals' && q.calls.some((c) => c.method === 'insert'))!;
    expect(insert.calls.find((c) => c.method === 'insert')!.args[0].psp_provider).toBe('mock');
  });

  it('returns the withdrawal as PROCESSING when the provider has not confirmed yet — never "done" by itself', async () => {
    const { service, payouts } = setup({ withdrawal: { id: 'w1', status: 'PROCESSING' } });
    const r = await service.requestWithdrawal('u1', DTO, 'key-1');
    expect(r.withdrawal.status).toBe('PROCESSING');
    expect(payouts.dispatch).toHaveBeenCalledTimes(1);
  });

  it('tells the user when the provider refused, and that the money stayed in their wallet', async () => {
    const { service } = setup({ withdrawal: { id: 'w1', status: 'REVERSED' }, rejectedReason: 'Numéro invalide.' });
    const err: any = await service.requestWithdrawal('u1', DTO, 'key-1').catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toMatch(/Numéro invalide/);
    expect(err.message).toMatch(/resté dans votre portefeuille/);
  });
});
