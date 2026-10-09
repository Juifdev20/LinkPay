import { ConflictException } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { createFakeSupabase, has, RecordedQuery } from '../test-utils/fake-supabase';

const DTO = { recipient_wallet_number: 'SLP-000002', amount_cents: 10000, currency: 'CDF', pin: '1234' };

function setup(existing: any) {
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'transfers' && has(q, 'eq', 'idempotency_key')) return { data: existing };
    if (q.target === 'wallets') {
      if (has(q, 'eq', 'user_id', 'me')) return { data: { id: 'w-me', status: 'ACTIVE', user_id: 'me' } };
      if (has(q, 'eq', 'wallet_number', 'SLP-000002')) return { data: { id: 'w-bob' } };
      return { data: null };
    }
    return { data: null };
  });
  const verifyPin = jest.fn(async () => undefined);
  const service = new WalletsService(
    fake.service, {} as any, { create: jest.fn() } as any, { get: (_k: string, d?: any) => d } as any, { verifyPin } as any,
    {} as any, { log: jest.fn() } as any, {} as any, {} as any, { assessOutflow: jest.fn() } as any,
  );
  return { service, verifyPin };
}

const row = (over: any = {}) => ({ id: 't1', sender_wallet_id: 'w-me', recipient_wallet_id: 'w-bob', amount_cents: 10000, currency: 'CDF', status: 'SUCCESS', ...over });

describe('transfer idempotency: a key only replays the SAME operation by the SAME person', () => {
  it('the same sender, recipient and amount gets the original transfer back (a genuine retry)', async () => {
    const { service } = setup(row());
    const res: any = await service.transfer('me', DTO, 'k1');
    expect(res.transfer.id).toBe('t1');
  });

  it("someone else's transfer is never handed back for a key they happen to reuse or guess", async () => {
    const { service } = setup(row({ sender_wallet_id: 'w-other' }));
    await expect(service.transfer('me', DTO, 'k1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('the same sender with a different amount, currency or recipient is a conflict, not a replay', async () => {
    await expect(setup(row({ amount_cents: 1 })).service.transfer('me', DTO, 'k1')).rejects.toBeInstanceOf(ConflictException);
    await expect(setup(row({ currency: 'USD' })).service.transfer('me', DTO, 'k1')).rejects.toBeInstanceOf(ConflictException);
    await expect(setup(row({ recipient_wallet_id: 'w-carol' })).service.transfer('me', DTO, 'k1')).rejects.toBeInstanceOf(ConflictException);
  });
});
