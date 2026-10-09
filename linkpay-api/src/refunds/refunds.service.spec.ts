import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RefundsService } from './refunds.service';
import { createFakeSupabase, has, RecordedQuery } from '../test-utils/fake-supabase';

const TX = { id: 'tx1', merchant_id: 'm1', client_id: 'client-1', amount_cents: 3000, currency: 'CDF', status: 'SUCCESS', reference: 'REF1' };

function setup(opts: { rpcError?: string; clientId?: string | null } = {}) {
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'transactions') return { data: { ...TX, client_id: opts.clientId === undefined ? TX.client_id : opts.clientId } };
    if (q.target === 'rpc:refund_to_client_wallet') {
      return opts.rpcError ? { data: null, error: { message: opts.rpcError } } : { data: { id: 'r1', status: 'COMPLETED', amount_cents: 1000 } };
    }
    return undefined;
  });
  const notifications = { create: jest.fn(async () => undefined) };
  const service = new RefundsService(fake.service, notifications as any);
  return { service, fake, notifications };
}

describe('RefundsService.createRefund', () => {
  it("refuses a merchant refunding another store's transaction, before touching any money", async () => {
    const { service, fake } = setup();
    await expect(service.createRefund('tx1', { amount_cents: 100 }, 'u1', 'other-store', 'merchant')).rejects.toBeInstanceOf(ForbiddenException);
    expect(fake.queries.some((q) => q.target.startsWith('rpc:'))).toBe(false);
  });

  it('refunds through the atomic wallet-to-wallet function and tells the client', async () => {
    const { service, fake, notifications } = setup();
    const refund: any = await service.createRefund('tx1', { amount_cents: 1000, reason: 'erreur' }, 'u1', 'm1', 'merchant');
    expect(refund.status).toBe('COMPLETED');
    const rpc = fake.queries.find((q) => q.target === 'rpc:refund_to_client_wallet')!;
    expect(rpc.calls[0].args[0]).toEqual({ p_transaction_id: 'tx1', p_amount_cents: 1000, p_reason: 'erreur', p_processed_by: 'u1' });
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'client-1', type: 'refund_received' }));
  });

  it('blocks the refund when the merchant wallet is too low, and says how much is missing', async () => {
    const { service, notifications } = setup({ rpcError: 'REFUND_INSUFFICIENT_BALANCE:50000:200000' });
    const err: any = await service.createRefund('tx1', { amount_cents: 200000 }, 'u1', 'm1', 'merchant').catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toMatch(/Solde insuffisant/);
    expect(err.message).toMatch(/500/); // balance 500,00
    expect(err.message).toMatch(/2[\s  ]?000/); // needed 2 000,00
    expect(err.message).toMatch(/espèces/);
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it.each([
    ['REFUND_NO_CLIENT_ACCOUNT', /compte ScanLinkPay.*espèces/],
    ['REFUND_TX_SETTLED', /règlement/],
    ['REFUND_EXCEEDS_AMOUNT', /dépasserait/],
    ['REFUND_TX_NOT_REFUNDABLE', /réussies/],
    ['REFUND_TX_NOT_CREDITED', /pas encore été crédité/],
    ['REFUND_WALLET_NOT_ACTIVE', /suspendu ou gelé/],
  ])('maps %s to a clear message', async (code, message) => {
    const { service } = setup({ rpcError: `ERROR: ${code}` });
    await expect(service.createRefund('tx1', { amount_cents: 100 }, 'u1', 'm1', 'merchant')).rejects.toThrow(message);
  });
});
