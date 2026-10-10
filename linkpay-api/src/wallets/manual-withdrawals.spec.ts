import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ManualWithdrawalsService } from './manual-withdrawals.service';
import { WithdrawalPayoutService } from './withdrawal-payout.service';
import { createFakeSupabase, has, RecordedQuery } from '../test-utils/fake-supabase';

const manualAdapter = { supportsPayout: false, getPayoutStatus: jest.fn(async () => ({ status: 'NOT_FOUND' })), payout: jest.fn() };
const autoAdapter = { getPayoutStatus: jest.fn(async () => ({ status: 'NOT_FOUND' })), payout: jest.fn() };
const factory = { get: (p?: string) => (p === 'flexpaie' ? manualAdapter : autoAdapter) } as any;

const W = (over: any = {}) => ({ id: '11111111-1111-4111-8111-111111111111', wallet_id: 'wal1', amount_cents: 200000, fee_cents: 5000, currency: 'CDF', channel: 'mobile_money', destination: { operator: 'vodacom', phone: '+243828497218' }, psp_provider: 'flexpaie', status: 'PENDING', created_at: new Date(Date.now() - 3_600_000).toISOString(), updated_at: new Date(Date.now() - 3_600_000).toISOString(), ...over });

function setupService(rows: any[], opts: { owner?: string } = {}) {
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'withdrawals') return { data: has(q, 'maybeSingle') ? rows.find((r) => r.id === q.calls.find((c) => c.method === 'eq')?.args[1]) ?? null : rows };
    if (q.target === 'wallets') return { data: has(q, 'maybeSingle') ? { user_id: opts.owner ?? 'user-1' } : [{ id: 'wal1', user_id: 'user-1', wallet_number: 'SLP-CLI-000001' }] };
    if (q.target === 'profiles') return { data: [{ id: 'user-1', full_name: 'Amina Kabongo', email: 'amina@x.com', phone: '+243828497218' }] };
    return undefined;
  });
  const payouts = { apply: jest.fn(async (id: string, o: any) => ({ id, status: o.status === 'SUCCESS' ? 'SUCCESS' : 'REVERSED' })) };
  const audit = { log: jest.fn(async () => undefined) };
  const service = new ManualWithdrawalsService(fake.service, factory, payouts as any, audit as any);
  return { service, fake, payouts, audit };
}

describe('withdrawals the provider cannot send', () => {
  describe('dispatch', () => {
    it('does NOT call the provider: the request stays PENDING with the money reserved', async () => {
      const fake = createFakeSupabase(() => undefined);
      const service = new WithdrawalPayoutService(fake.service, factory, { create: jest.fn() } as any);
      manualAdapter.payout.mockClear();
      const r = await service.dispatch(W());
      expect(r.manual).toBe(true);
      expect(r.withdrawal.status).toBe('PENDING');
      expect(manualAdapter.payout).not.toHaveBeenCalled();
      expect(fake.queries).toHaveLength(0); // no refund, no state change
    });
    it('a provider that CAN send keeps the normal path', async () => {
      const fake = createFakeSupabase(() => undefined);
      const adapter = { payout: jest.fn(async () => ({ psp_payout_id: 'p1', status: 'PENDING' })) };
      const service = new WithdrawalPayoutService(fake.service, { get: () => adapter } as any, { create: jest.fn() } as any);
      const r = await service.dispatch(W({ psp_provider: 'mock' }));
      expect(adapter.payout).toHaveBeenCalled();
      expect(r.manual).toBeUndefined();
    });
  });

  describe('reconciliation', () => {
    it('NEVER refunds a manual withdrawal because the provider "does not know" it (an admin may be sending the money)', async () => {
      const old = W({ created_at: new Date(Date.now() - 3 * 3_600_000).toISOString() });
      const fake = createFakeSupabase((q) => (q.target === 'withdrawals' ? { data: [old] } : undefined));
      const service = new WithdrawalPayoutService(fake.service, factory, { create: jest.fn() } as any);
      expect(await service.reconcile()).toBe(0);
      expect(fake.queries.filter((q) => q.target.startsWith('rpc:'))).toHaveLength(0);
      expect(manualAdapter.getPayoutStatus).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('shows only the manual ones, with who asked and where to send', async () => {
      const { service } = setupService([W(), W({ id: '22222222-2222-4222-8222-222222222222', psp_provider: 'mock' })]);
      const r = await service.list('open');
      expect(r.data).toHaveLength(1);
      expect(r.data[0]).toMatchObject({ id: expect.any(String), amount_cents: 200000, fee_cents: 5000, destination: { operator: 'vodacom', phone: '+243828497218' }, owner: { name: 'Amina Kabongo', wallet_number: 'SLP-CLI-000001' } });
    });
  });

  describe('marked as sent', () => {
    it('settles it as SUCCESS with the reference, and audits who did it', async () => {
      const { service, payouts, audit } = setupService([W()]);
      await service.markSent('admin-1', W().id, '  TX-998877  ');
      expect(payouts.apply).toHaveBeenCalledWith(W().id, { status: 'SUCCESS', psp_reference: 'TX-998877' });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'admin-1', action: 'withdrawal_manual_sent', entity_id: W().id }));
    });
    it('an admin can never settle a withdrawal of their own wallet', async () => {
      const { service, payouts } = setupService([W()], { owner: 'admin-1' });
      await expect(service.markSent('admin-1', W().id)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.reject('admin-1', W().id, 'test')).rejects.toBeInstanceOf(ForbiddenException);
      expect(payouts.apply).not.toHaveBeenCalled();
    });
    it('refuses what is already settled, unknown, or not a manual withdrawal', async () => {
      const done = setupService([W({ status: 'SUCCESS' })]);
      await expect(done.service.markSent('admin-1', W().id)).rejects.toBeInstanceOf(BadRequestException);
      const unknown = setupService([]);
      await expect(unknown.service.markSent('admin-1', W().id)).rejects.toBeInstanceOf(NotFoundException);
      const auto = setupService([W({ psp_provider: 'mock' })]);
      await expect(auto.service.markSent('admin-1', W().id)).rejects.toThrow(/prestataire/);
      expect(done.payouts.apply).not.toHaveBeenCalled();
      expect(auto.payouts.apply).not.toHaveBeenCalled();
    });
  });

  describe('rejected', () => {
    it('needs a reason, then refunds through the failure path (amount and fee go back)', async () => {
      const { service, payouts, audit } = setupService([W()]);
      await expect(service.reject('admin-1', W().id, ' ')).rejects.toThrow(/raison/);
      expect(payouts.apply).not.toHaveBeenCalled();
      await service.reject('admin-1', W().id, 'Numéro Mobile Money incorrect');
      expect(payouts.apply).toHaveBeenCalledWith(W().id, { status: 'FAILED', reason: 'Numéro Mobile Money incorrect' });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'withdrawal_manual_rejected' }));
    });
  });
});
