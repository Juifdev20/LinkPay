import { completeFundedTransferOnce } from './funded-transfer-completion';
import { createFakeSupabase, has, RecordedQuery } from '../test-utils/fake-supabase';

const log = { warn: jest.fn() };
const TRANSFER = { id: 'tr1', sender_wallet_id: 'w1', recipient_wallet_id: 'w2', amount_cents: 20000, fee_cents: 0, currency: 'CDF', status: 'PENDING' };

describe('completeFundedTransferOnce — SQL function path (migration 062)', () => {
  it('reports a first completion as credited (with both parties, for the notifications)', async () => {
    const fake = createFakeSupabase((q) => (q.target === 'rpc:complete_funded_transfer' ? { data: [{ credited: true, sender_user_id: 'u1', recipient_user_id: 'u2', amount_cents: '20000', currency: 'CDF' }] } : undefined));
    expect(await completeFundedTransferOnce(fake.service.getClient(), 'tr1', 'psp1', log)).toEqual({ credited: true, senderUserId: 'u1', recipientUserId: 'u2', amountCents: 20000, currency: 'CDF' });
    expect(fake.queries[0].calls[0].args[0]).toEqual({ p_transfer_id: 'tr1', p_psp_intent_id: 'psp1' });
  });

  it('a second or concurrent confirmation is not credited again', async () => {
    const fake = createFakeSupabase((q) => (q.target === 'rpc:complete_funded_transfer' ? { data: [{ credited: false }] } : undefined));
    expect((await completeFundedTransferOnce(fake.service.getClient(), 'tr1', undefined, log)).credited).toBe(false);
  });

  it('an unknown transfer and a database failure are errors (never a silent success)', async () => {
    const notFound = createFakeSupabase(() => ({ error: { message: 'FUNDED_TRANSFER_NOT_FOUND' } }));
    await expect(completeFundedTransferOnce(notFound.service.getClient(), 'x', undefined, log)).rejects.toThrow(/not found/);
    const broken = createFakeSupabase(() => ({ error: { message: 'connection reset' } }));
    await expect(completeFundedTransferOnce(broken.service.getClient(), 'tr1', undefined, log)).rejects.toThrow(/connection reset/);
  });
});

describe('completeFundedTransferOnce — fallback when the function is not installed', () => {
  const MISSING = { message: 'Could not find the function public.complete_funded_transfer in the schema cache' };
  const make = (opts: { claimed?: boolean; creditError?: boolean }) =>
    createFakeSupabase((q: RecordedQuery) => {
      if (q.target === 'rpc:complete_funded_transfer') return { error: MISSING };
      if (q.target === 'rpc:credit_wallet') return opts.creditError ? { error: { message: 'boom' } } : { data: 1 };
      if (q.target === 'transfers') {
        if (has(q, 'update')) return { data: opts.claimed === false ? null : { ...TRANSFER, status: 'SUCCESS' } };
        return { data: TRANSFER };
      }
      if (q.target === 'wallets') return { data: { user_id: has(q, 'eq', 'id', 'w2') ? 'u2' : 'u1' } };
      return undefined;
    });

  it('claims PENDING → SUCCESS first, then credits the recipient once', async () => {
    const fake = make({});
    expect(await completeFundedTransferOnce(fake.service.getClient(), 'tr1', 'psp', log)).toMatchObject({ credited: true, amountCents: 20000 });
    const credit = fake.queries.find((q) => q.target === 'rpc:credit_wallet');
    expect(credit?.calls[0].args[0]).toMatchObject({ p_wallet_id: 'w2', p_amount_cents: 20000, p_entry_type: 'TRANSFER_IN' });
  });

  it('does nothing when someone else already claimed it (no second credit)', async () => {
    const fake = make({ claimed: false });
    expect((await completeFundedTransferOnce(fake.service.getClient(), 'tr1', 'psp', log)).credited).toBe(false);
    expect(fake.queries.some((q) => q.target === 'rpc:credit_wallet')).toBe(false);
  });

  it('puts the status back to PENDING when the credit fails, so the payment is not lost', async () => {
    const fake = make({ creditError: true });
    await expect(completeFundedTransferOnce(fake.service.getClient(), 'tr1', 'psp', log)).rejects.toThrow(/Failed to credit/);
    const restore = fake.queries.find((q) => q.calls.some((c) => c.method === 'update' && c.args[0]?.status === 'PENDING'));
    expect(restore).toBeDefined();
  });
});
