import { ConflictException } from '@nestjs/common';
import { TontinesService } from './tontines.service';
import { createFakeSupabase, has, RecordedQuery } from '../test-utils/fake-supabase';

const DAY = 86_400_000;
const group = { id: 'g1', name: 'Tontine Amis', max_members: 5, late_penalty_enabled: true, late_penalty_percent_per_day: 50, grace_period_days: 0, frequency: 'monthly' };
const cycle = { id: 'c1', cycle_number: 1, recipient_member_id: 'rm1' };
const lateContribution = () => ({ id: 'k1', amount_cents: 10000, currency: 'CDF', due_date: new Date(Date.now() - 4 * DAY).toISOString().slice(0, 10) });

function setup(opts: { claimGranted?: boolean; transferError?: Error; transferStatus?: string } = {}) {
  const granted = opts.claimGranted ?? true;
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'tontine_members') return { data: { user_id: 'recipient-user', id: 'rm1' } };
    if (q.target === 'wallets') return { data: { wallet_number: 'SLP-000009' } };
    if (q.target === 'tontine_contributions') {
      if (has(q, 'select', 'id') && has(q, 'update')) return { data: granted ? { id: 'k1' } : null }; // the claim
      if (has(q, 'select', '*', { count: 'exact', head: true })) return { count: 1 }; // someone else still owes: cycle stays open
    }
    return undefined;
  });
  const transfer = jest.fn(async () => {
    if (opts.transferError) throw opts.transferError;
    return { transfer: { id: 't1', status: opts.transferStatus ?? 'SUCCESS' } };
  });
  const notifications = { create: jest.fn(async () => undefined) };
  const service = new TontinesService(fake.service, { transfer } as any, notifications as any);
  // The release is the only update that sets claimed_at back to null.
  const releases = () =>
    fake.queries.filter((q) => q.target === 'tontine_contributions' && has(q, 'update', { claimed_at: null })).length;
  return { service: service as any, transfer, notifications, releases, fake };
}

describe('tontine contributions are paid once', () => {
  it('refuses a second attempt while one is already paying (e.g. the 9am job and the member at once) — no money moves', async () => {
    const { service, transfer } = setup({ claimGranted: false });
    await expect(service.executeContribution(group, cycle, lateContribution(), 'payer', '1234', 'key', false)).rejects.toBeInstanceOf(ConflictException);
    expect(transfer).not.toHaveBeenCalled();
  });

  it('claims first, transfers once, and keeps the claim when the payment succeeds', async () => {
    const { service, transfer, releases } = setup();
    await service.executeContribution(group, cycle, lateContribution(), 'payer', '1234', 'key', false);
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(releases()).toBe(0);
  });

  it('never marks a contribution paid from a transfer that did not complete (a replayed key can return a FAILED or PENDING one)', async () => {
    for (const transferStatus of ['FAILED', 'PENDING']) {
      const { service, releases, fake } = setup({ transferStatus });
      await expect(service.executeContribution(group, cycle, lateContribution(), 'payer', '1234', 'key', false)).rejects.toThrow(/n'a pas abouti/);
      expect(fake.queries.some((q) => q.target === 'tontine_contributions' && has(q, 'update', { status: 'paid' }))).toBe(false);
      expect(releases()).toBe(1);
    }
  });

  it('uses a transfer key of its own (the client key is namespaced by the contribution), so it cannot replay an unrelated transfer', async () => {
    const { service, transfer } = setup();
    await service.executeContribution(group, cycle, lateContribution(), 'payer', '1234', 'client-key', false);
    expect((transfer.mock.calls as any[])[0][2]).toBe('tontine:k1:client-key');
  });

  it('releases the claim when the payment fails, so a retry is possible', async () => {
    const { service, releases } = setup({ transferError: new Error('Solde insuffisant') });
    await expect(service.executeContribution(group, cycle, lateContribution(), 'payer', '1234', 'key', false)).rejects.toThrow('Solde insuffisant');
    expect(releases()).toBe(1);
  });
});

describe('tontine late penalty', () => {
  it('charges the penalty when the member pays themselves with their PIN', async () => {
    const { service, transfer } = setup();
    await service.executeContribution(group, cycle, lateContribution(), 'payer', '1234', 'key', false);
    const sent = (transfer.mock.calls as any[])[0][1].amount_cents;
    expect(sent).toBeGreaterThan(10000); // 4 days late at 50 %/day
  });

  it('never charges more than the base amount on a debit made without a PIN (auto-payment)', async () => {
    const { service, transfer } = setup();
    await service.executeContribution(group, cycle, lateContribution(), 'payer', '', 'key', true);
    expect((transfer.mock.calls as any[])[0][1].amount_cents).toBe(10000);
  });
});

describe('autoContribute', () => {
  it('stays silent when the contribution is already being paid — that is not a failure to tell the member about', async () => {
    const { service, notifications } = setup({ claimGranted: false });
    jest.spyOn(service, 'getGroupById').mockResolvedValue(group);
    // cycle + member lookups made by autoContribute itself
    const fake = createFakeSupabase((q: RecordedQuery) => {
      if (q.target === 'tontine_cycles') return { data: cycle };
      if (q.target === 'tontine_members') return { data: { user_id: 'member-user' } };
      return { data: null };
    });
    const svc: any = new TontinesService(fake.service, { transfer: jest.fn() } as any, notifications as any);
    jest.spyOn(svc, 'getGroupById').mockResolvedValue(group);
    jest.spyOn(svc, 'executeContribution').mockRejectedValue(new ConflictException('déjà en cours'));
    await svc.autoContribute({ ...lateContribution(), group_id: 'g1', cycle_id: 'c1', member_id: 'm1' });
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('still tells the member when the payment really failed', async () => {
    const { notifications } = setup();
    const fake = createFakeSupabase((q: RecordedQuery) => {
      if (q.target === 'tontine_cycles') return { data: cycle };
      if (q.target === 'tontine_members') return { data: { user_id: 'member-user' } };
      return { data: null };
    });
    const svc: any = new TontinesService(fake.service, { transfer: jest.fn() } as any, notifications as any);
    jest.spyOn(svc, 'getGroupById').mockResolvedValue(group);
    jest.spyOn(svc, 'executeContribution').mockRejectedValue(new Error('Solde insuffisant'));
    await svc.autoContribute({ ...lateContribution(), group_id: 'g1', cycle_id: 'c1', member_id: 'm1' });
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'tontine_auto_payment_failed' }));
  });
});
