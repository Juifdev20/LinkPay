import { WalletsService } from './wallets.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

const entries = [
  { id: 'e1', entry_type: 'TRANSFER_OUT', direction: 'debit', metadata: { counterparty_wallet_id: 'w2' } },
  { id: 'e2', entry_type: 'PAYMENT', direction: 'debit', metadata: { payment_request_id: 'pr1' } },
  { id: 'e3', entry_type: 'PAYMENT', direction: 'credit', metadata: { merchant_id: 'm2' } },
  { id: 'e4', entry_type: 'WITHDRAWAL', direction: 'debit', metadata: { withdrawal_id: 'x1' } },
  { id: 'e5', entry_type: 'TOPUP', direction: 'credit', metadata: {} },
  { id: 'e6', entry_type: 'ADJUSTMENT', direction: 'credit', metadata: {} },
];

describe('wallet history: who each movement was with (display only)', () => {
  it('names the other person, the merchant, the withdrawal network; never fails on a missing name', async () => {
    const fake = createFakeSupabase((q: RecordedQuery) => {
      if (q.target === 'wallets' && q.calls.some((c) => c.method === 'in')) return { data: [{ id: 'w2', user_id: 'u2' }] };
      if (q.target === 'wallets') return { data: { id: 'w1', user_id: 'u1', status: 'ACTIVE' } };
      if (q.target === 'ledger_entries') return { data: entries, count: entries.length };
      if (q.target === 'profiles') return { data: [{ id: 'u2', full_name: 'Jean Dupont' }] };
      if (q.target === 'payment_requests') return { data: [{ id: 'pr1', merchant_id: 'm1' }] };
      if (q.target === 'merchants') return { data: [{ id: 'm1', name: 'Supermarché Kivu' }, { id: 'm2', name: 'Boutique Kivu' }] };
      if (q.target === 'withdrawals') return { data: [{ id: 'x1', channel: 'mobile_money', destination: { operator: 'orange' } }] };
      return { data: null };
    });
    const service = new WalletsService(fake.service, {} as any, {} as any, { get: (_k: string, d?: any) => d } as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    const { data } = await service.getMyLedger('u1', { page: 1, limit: 20 });
    expect(data.map((e: any) => e.counterparty)).toEqual(['Jean Dupont', 'Supermarché Kivu', 'Boutique Kivu', 'Orange Money', 'Mobile Money', null]);
  });
});
