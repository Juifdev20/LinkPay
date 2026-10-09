import { BadRequestException } from '@nestjs/common';
import { PosService } from './pos.service';
import { createFakeSupabase, has, RecordedQuery } from '../test-utils/fake-supabase';

const TICKET = { id: 't1', total_cents: 100000, currency: 'CDF', ticket_number: 7, payment_request_id: null };

function setup(rpcResult: { data?: any; error?: { message: string } }) {
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'rpc:add_pos_payment') return rpcResult;
    return { data: null };
  });
  const createPaymentRequest = jest.fn(async () => ({ id: 'pr1', link_token: 'tok' }));
  // Constructor: (supabase, stock, audit, paymentRequests, ...) — resolved by position below.
  const service: any = Object.create(PosService.prototype);
  service.supabaseService = fake.service;
  service.paymentRequestsService = { createPaymentRequest };
  Object.defineProperty(service, 'db', { get: () => fake.service.getClient() });
  service.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  jest.spyOn(service, 'loadOpenTicket').mockResolvedValue({ ticket: TICKET, items: [], payments: [], merchant: { pos_tva_rate_pct: 0 } });
  jest.spyOn(service, 'syncTotals').mockResolvedValue(TICKET);
  jest.spyOn(service, 'settleIfFullyPaid').mockImplementation(async (t: any) => ({ ticket: t }));
  return { service, fake, createPaymentRequest };
}

const call = (service: any, method: 'payCash' | 'payScanlinkpay', data: any = {}) =>
  service[method]('m1', 't1', 'u1', 'caissier', 'o1', data);

describe('POS payments go through the atomic add_pos_payment function', () => {
  it('records a cash payment through the locked SQL function', async () => {
    const { service, fake } = setup({ data: { id: 'p1', amount_cents: 100000, method: 'cash' } });
    await call(service, 'payCash', { amount_cents: 100000, received_cents: 120000 });
    const rpc = fake.queries.find((q) => q.target === 'rpc:add_pos_payment')!;
    expect(rpc.calls[0].args[0]).toMatchObject({ p_ticket_id: 't1', p_method: 'cash', p_amount_cents: 100000, p_received_cents: 120000, p_status: 'confirmed' });
  });

  it('a double tap: the second payment is refused as "already fully paid" instead of being recorded twice', async () => {
    const { service } = setup({ error: { message: 'POS_PAYMENT_EXCEEDS_REMAINING:0' } });
    await expect(call(service, 'payCash', { amount_cents: 100000 })).rejects.toThrow('Ce ticket est déjà entièrement réglé.');
  });

  it('tells how much is still owed when a part was paid in the meantime', async () => {
    const { service } = setup({ error: { message: 'POS_PAYMENT_EXCEEDS_REMAINING:40000' } });
    await expect(call(service, 'payCash', { amount_cents: 100000 })).rejects.toThrow(/reste à payer : 400/);
  });

  it('refuses a ticket that is no longer open', async () => {
    const { service } = setup({ error: { message: 'POS_TICKET_NOT_OPEN' } });
    await expect(call(service, 'payCash', { amount_cents: 100000 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ScanLinkPay part: records it pending, linked to the payment request', async () => {
    const { service, fake } = setup({ data: { id: 'p2', method: 'scanlinkpay', amount_cents: 100000, status: 'pending' } });
    await call(service, 'payScanlinkpay');
    const rpc = fake.queries.find((q) => q.target === 'rpc:add_pos_payment')!;
    expect(rpc.calls[0].args[0]).toMatchObject({ p_method: 'scanlinkpay', p_status: 'pending', p_payment_request_id: 'pr1' });
  });

  it('ScanLinkPay part refused at the last moment: the QR that was just created is cancelled', async () => {
    const { service, fake } = setup({ error: { message: 'POS_PAYMENT_EXCEEDS_REMAINING:0' } });
    await expect(call(service, 'payScanlinkpay')).rejects.toBeInstanceOf(BadRequestException);
    const cancel = fake.queries.find((q) => q.target === 'payment_requests' && has(q, 'update'))!;
    expect(cancel.calls.find((c) => c.method === 'update')!.args[0].status).toBe('CANCELLED');
  });
});
