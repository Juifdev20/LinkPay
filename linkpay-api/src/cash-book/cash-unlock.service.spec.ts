import * as bcrypt from 'bcryptjs';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';
import { CashUnlockService, isTrivialSecret } from './cash-unlock.service';
import { CashDayLockService } from './cash-day-lock.service';

const NOW = new Date('2026-10-22T10:00:00Z').getTime();
const MERCHANT = { id: 'st1', name: 'Station Kasindi', organization_id: 'org1', owner_id: 'boss' };
const CLOSED = { id: 'c1', merchant_id: 'st1', business_day: '2026-10-22', currency: 'CDF', status: 'closed', closed_by: 'u1' };

function setup(opts: { secret?: string; attempts?: number; lockedUntil?: string; closing?: any } = {}) {
  const state: any = { secret: opts.secret ? { secret_hash: bcrypt.hashSync(opts.secret, 4), attempts: opts.attempts || 0, locked_until: opts.lockedUntil || null } : null };
  const fake = createFakeSupabase((q: RecordedQuery) => {
    const write = q.calls.find((c) => ['insert', 'update', 'upsert'].includes(c.method));
    switch (q.target) {
      case 'cash_unlock_secrets':
        if (write) { if (write.method === 'upsert') state.secret = { secret_hash: write.args[0].secret_hash, attempts: 0, locked_until: null }; else Object.assign(state.secret, write.args[0]); return { data: null }; }
        return { data: state.secret };
      case 'cash_day_closings':
        if (write) return { data: { ...(opts.closing || CLOSED), ...write.args[0] } };
        return { data: opts.closing === undefined ? CLOSED : opts.closing };
      case 'profiles': return { data: { full_name: 'Alice' } };
      case 'organizations': return { data: { owner_id: 'boss' } };
      case 'organization_staff': return { data: [] };
      default: return { data: null };
    }
  });
  const stock = { resolveMerchantAccess: jest.fn().mockResolvedValue(MERCHANT) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const notifications = { create: jest.fn().mockResolvedValue(undefined) };
  const service = new CashUnlockService(fake.service, stock as any, audit as any, notifications as any);
  const events = () => fake.queries.filter((q) => q.target === 'cash_unlock_events').map((q) => q.calls.find((c) => c.method === 'insert')?.args[0]).filter(Boolean);
  return { service, fake, state, audit, notifications, events };
}

describe('CashUnlockService', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(NOW));
  afterEach(() => jest.restoreAllMocks());

  it('refuses trivial or short secrets and a wrong confirmation', async () => {
    expect(isTrivialSecret('123456')).toBe(true);
    expect(isTrivialSecret('aaaaaa')).toBe(true);
    expect(isTrivialSecret('abcdef')).toBe(true);
    expect(isTrivialSecret('k7#Pq2')).toBe(false);
    const t = setup();
    await expect(t.service.setSecret('u1', { secret: 'ab1', confirm: 'ab1' })).rejects.toThrow('6 caractères');
    await expect(t.service.setSecret('u1', { secret: 'k7#Pq2', confirm: 'k7#Pq3' })).rejects.toThrow('confirmation');
    await expect(t.service.setSecret('u1', { secret: '123456', confirm: '123456' })).rejects.toThrow('facile');
  });

  it('creates the secret (hashed) and records it; changing it needs the current one', async () => {
    const t = setup();
    await t.service.setSecret('u1', { secret: 'k7#Pq2', confirm: 'k7#Pq2' }, 'st1');
    expect(t.state.secret.secret_hash).not.toContain('k7#Pq2');
    expect(await bcrypt.compare('k7#Pq2', t.state.secret.secret_hash)).toBe(true);
    expect(t.events()[0]).toMatchObject({ action: 'secret_set', user_id: 'u1' });
    await expect(t.service.setSecret('u1', { secret: 'n3w#Code', confirm: 'n3w#Code' })).rejects.toThrow('code actuel');
    await t.service.setSecret('u1', { secret: 'n3w#Code', confirm: 'n3w#Code', current: 'k7#Pq2' });
    expect(await bcrypt.compare('n3w#Code', t.state.secret.secret_hash)).toBe(true);
  });

  it('unlocks today with the right code and a reason: reopens the day, traces and notifies', async () => {
    const t = setup({ secret: 'k7#Pq2' });
    const row: any = await t.service.unlockDay('st1', 'c1', { secret: 'k7#Pq2', reason: 'Client urgent, livraison' }, 'u1', 'caissier', 'org1');
    expect(row.status).toBe('reopened');
    expect(row.reopen_reason).toContain('Urgence');
    const ev = t.events();
    expect(ev[ev.length - 1]).toMatchObject({ action: 'unlock', reason: 'Client urgent, livraison', user_id: 'u1', business_day: '2026-10-22', merchant_id: 'st1' });
    expect(ev[ev.length - 1].created_at).toBe(new Date(NOW).toISOString());
    expect(t.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'cash_day_unlocked' }));
    expect(t.notifications.create).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'boss', type: 'cash_day_unlocked' }));
  });

  it('refuses a short reason, a missing code, a wrong code (recorded), a past day and an open day', async () => {
    const t = setup({ secret: 'k7#Pq2' });
    await expect(t.service.unlockDay('st1', 'c1', { secret: 'k7#Pq2', reason: 'urgent' }, 'u1', 'caissier', 'org1')).rejects.toThrow('motif');
    await expect(t.service.unlockDay('st1', 'c1', { secret: 'bad', reason: 'Client urgent, livraison' }, 'u1', 'caissier', 'org1')).rejects.toThrow('incorrect');
    expect(t.events().pop()).toMatchObject({ action: 'failed_attempt', user_id: 'u1' });

    const none = setup();
    await expect(none.service.unlockDay('st1', 'c1', { secret: 'x', reason: 'Client urgent, livraison' }, 'u1', 'caissier', 'org1')).rejects.toThrow('pas encore de code');

    const past = setup({ secret: 'k7#Pq2', closing: { ...CLOSED, business_day: '2026-10-21' } });
    await expect(past.service.unlockDay('st1', 'c1', { secret: 'k7#Pq2', reason: 'Client urgent, livraison' }, 'u1', 'caissier', 'org1')).rejects.toThrow('journée en cours');

    const open = setup({ secret: 'k7#Pq2', closing: { ...CLOSED, status: 'reopened' } });
    await expect(open.service.unlockDay('st1', 'c1', { secret: 'k7#Pq2', reason: 'Client urgent, livraison' }, 'u1', 'caissier', 'org1')).rejects.toThrow('pas verrouillée');
  });

  it('locks the unlocking for 15 minutes after 5 wrong codes, even with the right one', async () => {
    const t = setup({ secret: 'k7#Pq2', attempts: 4 });
    await expect(t.service.unlockDay('st1', 'c1', { secret: 'bad', reason: 'Client urgent, livraison' }, 'u1', 'caissier', 'org1')).rejects.toThrow('bloqué');
    expect(t.state.secret.locked_until).toBe(new Date(NOW + 15 * 60_000).toISOString());
    expect(t.events().pop()).toMatchObject({ action: 'blocked' });
    await expect(t.service.unlockDay('st1', 'c1', { secret: 'k7#Pq2', reason: 'Client urgent, livraison' }, 'u1', 'caissier', 'org1')).rejects.toThrow('bloqué');
  });

  it('shows only their own events to a seller', async () => {
    const t = setup();
    await t.service.listEvents('st1', undefined, undefined, 'u1', 'caissier', 'org1');
    const q = t.fake.queries.find((x) => x.target === 'cash_unlock_events')!;
    expect(q.calls.some((c) => c.method === 'eq' && c.args[0] === 'user_id' && c.args[1] === 'u1')).toBe(true);
    await t.service.listEvents('st1', undefined, undefined, 'boss', 'enterprise', 'org1');
    const q2 = t.fake.queries.filter((x) => x.target === 'cash_unlock_events')[1];
    expect(q2.calls.some((c) => c.method === 'eq' && c.args[0] === 'user_id')).toBe(false);
  });
});

describe('CashDayLockService', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(NOW));
  afterEach(() => jest.restoreAllMocks());

  it('refuses with CASH_DAY_CLOSED when today is closed, allows otherwise', async () => {
    const closed = new CashDayLockService(createFakeSupabase((q) => (q.calls.some((c) => c.method === 'lt' && c.args[0] === 'business_day') ? { data: [] } : q.target === 'cash_day_closings' ? { data: [{ id: 'c1' }] } : { data: [] })).service);
    await expect(closed.assertDayOpen('st1', 'CDF')).rejects.toMatchObject({ response: expect.objectContaining({ code: 'CASH_DAY_CLOSED', closing_id: 'c1' }) });
    const open = new CashDayLockService(createFakeSupabase(() => ({ data: [] })).service);
    await expect(open.assertDayOpen('st1', 'CDF')).resolves.toBeUndefined();
  });

  it('looks at today (business day) and at the sale currency', async () => {
    const fake = createFakeSupabase(() => ({ data: [] }));
    await new CashDayLockService(fake.service).assertDayOpen('st1', 'USD');
    const calls = fake.queries.filter((q) => q.target === 'cash_day_closings').pop()!.calls;
    expect(calls).toContainEqual({ method: 'eq', args: ['business_day', '2026-10-22'] });
    expect(calls).toContainEqual({ method: 'eq', args: ['status', 'closed'] });
    expect(calls).toContainEqual({ method: 'eq', args: ['currency', 'USD'] });
  });
});

describe('CashDayLockService — previous day first', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(NOW)); // Thursday 22 October 2026
  afterEach(() => jest.restoreAllMocks());

  /** closings = closed days; activity = paid sales by `paid_at`. */
  function lockWith(opts: { closed?: string[]; salesAt?: string[]; todayClosed?: boolean }) {
    const fake = createFakeSupabase((q: RecordedQuery) => {
      const eq = (k: string) => q.calls.find((c) => c.method === 'eq' && c.args[0] === k)?.args[1];
      if (q.target === 'cash_day_closings') {
        const lt = q.calls.find((c) => c.method === 'lt' && c.args[0] === 'business_day')?.args[1];
        if (lt) return { data: (opts.closed || []).filter((d) => d < lt).sort().reverse().slice(0, 1).map((d) => ({ business_day: d })) };
        return { data: opts.todayClosed ? [{ id: 'c-today' }] : [] };
      }
      if (q.target === 'sales') {
        const gte = q.calls.find((c) => c.method === 'gte')?.args[1];
        const lt = q.calls.find((c) => c.method === 'lt')?.args[1];
        return { data: (opts.salesAt || []).filter((t) => t >= gte && t < lt).map((paid_at) => ({ paid_at })) };
      }
      return { data: [], ...(eq('x') ? {} : {}) };
    });
    return new CashDayLockService(fake.service);
  }

  it('refuses today when an earlier day with activity was never closed (after a first closing)', async () => {
    const lock = lockWith({ closed: ['2026-10-19'], salesAt: ['2026-10-20T10:00:00Z'] });
    await expect(lock.assertDayOpen('st1', 'CDF')).rejects.toMatchObject({ response: expect.objectContaining({ code: 'CASH_PREVIOUS_DAY_UNCLOSED', day: '2026-10-20' }) });
  });

  it('accepts once that day is closed, and does not look further when yesterday is closed', async () => {
    await expect(lockWith({ closed: ['2026-10-19', '2026-10-20', '2026-10-21'], salesAt: ['2026-10-20T10:00:00Z'] }).assertDayOpen('st1', 'CDF')).resolves.toBeUndefined();
    await expect(lockWith({ closed: ['2026-10-21'] }).assertDayOpen('st1', 'CDF')).resolves.toBeUndefined();
  });

  it('a day without any activity does not block', async () => {
    await expect(lockWith({ closed: ['2026-10-15'] }).assertDayOpen('st1', 'CDF')).resolves.toBeUndefined();
  });

  it('before any closing, the latest active day of the last week must be closed first; older ones are ignored', async () => {
    const lock = lockWith({ salesAt: ['2026-10-10T10:00:00Z', '2026-10-21T10:00:00Z'] });
    await expect(lock.assertDayOpen('st1', 'CDF')).rejects.toMatchObject({ response: expect.objectContaining({ code: 'CASH_PREVIOUS_DAY_UNCLOSED', day: '2026-10-21' }) });
    await expect(lockWith({ salesAt: ['2026-10-10T10:00:00Z'] }).assertDayOpen('st1', 'CDF')).resolves.toBeUndefined();
  });

  it('the unclosed past day is reported before the closed-today check', async () => {
    const lock = lockWith({ closed: ['2026-10-19'], salesAt: ['2026-10-20T10:00:00Z'], todayClosed: true });
    await expect(lock.assertDayOpen('st1', 'CDF')).rejects.toMatchObject({ response: expect.objectContaining({ code: 'CASH_PREVIOUS_DAY_UNCLOSED' }) });
  });
});
