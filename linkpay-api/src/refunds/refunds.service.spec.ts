import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RefundsService } from './refunds.service';
import { createFakeSupabase, has, RecordedQuery } from '../test-utils/fake-supabase';

const TX = { id: 'tx1', merchant_id: 'm1', amount_cents: 3000, currency: 'CDF', status: 'SUCCESS', psp_reference: 'psp1', reference: 'REF1' };

function setup(opts: { reserveError?: string; pspStatus?: string; pspThrows?: boolean; completedRefunds?: number[] } = {}) {
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'transactions' && has(q, 'select', '*')) return { data: TX };
    if (q.target === 'rpc:reserve_refund') {
      return opts.reserveError ? { data: null, error: { message: opts.reserveError } } : { data: { id: 'r1', status: 'PENDING' } };
    }
    if (q.target === 'refunds' && has(q, 'update')) return { data: { id: 'r1' } };
    if (q.target === 'refunds' && has(q, 'select', 'amount_cents')) return { data: (opts.completedRefunds ?? [1000]).map((a) => ({ amount_cents: a })) };
    return undefined;
  });
  const adapter = {
    refund: jest.fn(async () => {
      if (opts.pspThrows) throw new BadRequestException('PSP indisponible');
      return { psp_refund_id: 'pr1', status: opts.pspStatus ?? 'COMPLETED' };
    }),
  };
  const ledger = { writeRefundEntry: jest.fn(async () => undefined) };
  const service = new RefundsService(fake.service, { get: () => adapter } as any, ledger as any);
  const txStatusUpdate = () =>
    fake.queries.find((q) => q.target === 'transactions' && has(q, 'update'))?.calls.find((c) => c.method === 'update')?.args[0].status;
  return { service, fake, adapter, ledger, txStatusUpdate };
}

describe('RefundsService.createRefund', () => {
  it("refuses a merchant refunding another store's transaction", async () => {
    const { service, adapter } = setup();
    await expect(service.createRefund('tx1', { amount_cents: 100 }, 'u1', 'other-store', 'merchant')).rejects.toBeInstanceOf(ForbiddenException);
    expect(adapter.refund).not.toHaveBeenCalled();
  });

  it.each([
    ['REFUND_TX_SETTLED', /règlement/],
    ['REFUND_EXCEEDS_AMOUNT', /dépasserait/],
    ['REFUND_TX_NOT_REFUNDABLE', /réussies/],
  ])('maps %s to a clear message and never calls the PSP', async (code, message) => {
    const { service, adapter } = setup({ reserveError: `ERROR: ${code}` });
    await expect(service.createRefund('tx1', { amount_cents: 100 }, 'u1', 'm1', 'merchant')).rejects.toThrow(message);
    expect(adapter.refund).not.toHaveBeenCalled();
  });

  it('marks a partial refund PARTIALLY_REFUNDED, not REFUNDED', async () => {
    const { service, txStatusUpdate, ledger } = setup({ completedRefunds: [1000] });
    await service.createRefund('tx1', { amount_cents: 1000 }, 'u1', 'm1', 'merchant');
    expect(txStatusUpdate()).toBe('PARTIALLY_REFUNDED');
    expect(ledger.writeRefundEntry).toHaveBeenCalledWith(TX, 1000, 'r1');
  });

  it('marks the transaction REFUNDED once fully refunded', async () => {
    const { service, txStatusUpdate } = setup({ completedRefunds: [1000, 2000] });
    await service.createRefund('tx1', { amount_cents: 2000 }, 'u1', 'm1', 'merchant');
    expect(txStatusUpdate()).toBe('REFUNDED');
  });

  it('releases the reservation (FAILED) when the PSP refuses', async () => {
    const { service, fake, txStatusUpdate } = setup({ pspThrows: true });
    await expect(service.createRefund('tx1', { amount_cents: 500 }, 'u1', 'm1', 'merchant')).rejects.toThrow('PSP indisponible');
    const release = fake.queries.find((q) => q.target === 'refunds' && has(q, 'update'))!;
    expect(release.calls.find((c) => c.method === 'update')?.args[0].status).toBe('FAILED');
    expect(txStatusUpdate()).toBeUndefined();
  });

  it('leaves the transaction untouched while the PSP refund is still pending', async () => {
    const { service, txStatusUpdate, ledger } = setup({ pspStatus: 'PENDING' });
    await service.createRefund('tx1', { amount_cents: 500 }, 'u1', 'm1', 'merchant');
    expect(txStatusUpdate()).toBeUndefined();
    expect(ledger.writeRefundEntry).not.toHaveBeenCalled();
  });
});
