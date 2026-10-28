import { ForbiddenException } from '@nestjs/common';
import { AccountDeletionService } from './account-deletion.service';
import { createFakeSupabase, has, RecordedQuery } from '../test-utils/fake-supabase';

type World = {
  roles?: string[];
  staff?: any;
  ledger?: any[];
  pendingWithdrawal?: boolean;
  savings?: any[];
  tontines?: any[];
  cashiers?: boolean;
  employees?: boolean;
  passwordOk?: boolean;
};

function setup(w: World = {}) {
  const fake = createFakeSupabase((q: RecordedQuery) => {
    const isUpdate = q.calls.some((c) => ['update', 'insert', 'delete'].includes(c.method));
    if (isUpdate) return { data: null };
    switch (q.target) {
      case 'user_roles': return { data: (w.roles ?? ['client']).map((slug) => ({ role: { slug } })) };
      case 'organization_staff':
        return has(q, 'maybeSingle') ? { data: w.staff ?? null } : { data: w.employees ? [{ id: 'e1' }] : [] };
      case 'wallets': return { data: { id: 'w1' } };
      case 'ledger_entries': return { data: w.ledger ?? [] };
      case 'withdrawals': return { data: w.pendingWithdrawal ? [{ id: 'r1' }] : [] };
      case 'rpc:savings_pot_balances': return { data: w.savings ?? [] };
      case 'tontine_members': return { data: w.tontines ?? [] };
      case 'merchants': return { data: [{ id: 'm1' }] };
      case 'organizations': return { data: [{ id: 'o1' }] };
      case 'merchant_users': return { data: w.cashiers ? [{ id: 'c1' }] : [] };
      case 'profiles': return { data: { email: 'a@x.cd' } };
      default: return undefined;
    }
  });
  const client = fake.service.getClient();
  const updateUserById = jest.fn(async () => ({ error: null }));
  client.auth = {
    admin: { updateUserById, getUserById: async () => ({ data: { user: { email: 'a@x.cd' } } }) },
    signInWithPassword: async () => ({ error: w.passwordOk === false ? { message: 'bad' } : null }),
  };
  const audit = { log: jest.fn(async () => undefined) };
  const attempts = { reserve: jest.fn(async () => undefined), recordSuccess: jest.fn(async () => undefined) };
  return { service: new AccountDeletionService(fake.service, audit as any, attempts as any, { purgeAvatarOf: jest.fn(async () => undefined) } as any), fake, updateUserById, audit };
}

const codes = async (w: World) => (await setup(w).service.blockers('u1')).blockers.map((b) => b.code);

describe('who may delete their own account', () => {
  it('a client, a merchant and an enterprise owner, when nothing is left', async () => {
    expect(await codes({ roles: ['client'] })).toEqual([]);
    expect(await codes({ roles: ['merchant'] })).toEqual([]);
    expect(await codes({ roles: ['enterprise'] })).toEqual([]);
  });

  it('never an employee: vendeur/caissier, gérant… — the owner removes them', async () => {
    expect(await codes({ roles: ['cashier'] })).toEqual(['EMPLOYEE']);
    expect(await codes({ roles: ['gerant'] })).toEqual(['EMPLOYEE']);
    expect(await codes({ roles: ['client'], staff: { id: 's1', deactivated_at: null } })).toEqual(['EMPLOYEE']);
  });

  it('never an administrator', async () => {
    expect(await codes({ roles: ['super_admin'] })).toEqual(['ADMIN']);
  });
});

describe('money first: the deletion never takes or zeroes anything', () => {
  it('refused while there is a balance, a withdrawal on its way, savings or a running tontine', async () => {
    expect(await codes({ ledger: [{ amount_cents: 500, direction: 'credit', currency: 'USD' }] })).toContain('BALANCE');
    expect(await codes({ ledger: [{ amount_cents: 500, direction: 'credit', currency: 'CDF' }, { amount_cents: 500, direction: 'debit', currency: 'CDF' }] })).toEqual([]);
    expect(await codes({ pendingWithdrawal: true })).toContain('WITHDRAWAL');
    expect(await codes({ savings: [{ currency: 'CDF', balance_cents: '1000' }] })).toContain('SAVINGS');
    expect(await codes({ tontines: [{ status: 'active', group: { status: 'active' } }] })).toContain('TONTINE');
    expect(await codes({ tontines: [{ status: 'active', group: { status: 'completed' } }] })).toEqual([]);
  });

  it("the owner's team goes first", async () => {
    expect(await codes({ roles: ['merchant'], cashiers: true })).toContain('TEAM');
    expect(await codes({ roles: ['enterprise'], employees: true })).toContain('TEAM');
  });
});

describe('deleting', () => {
  it('needs the password, and is refused with the reason while something blocks', async () => {
    await expect(setup({ passwordOk: false }).service.deleteAccount('u1', { password: 'x', reason: 'fees' })).rejects.toBeInstanceOf(ForbiddenException);
    const blocked = setup({ ledger: [{ amount_cents: 1, direction: 'credit', currency: 'CDF' }] });
    await expect(blocked.service.deleteAccount('u1', { password: 'p', reason: 'fees' })).rejects.toMatchObject({ response: { code: 'DELETION_BLOCKED' } });
    expect(blocked.updateUserById).not.toHaveBeenCalled();
  });

  it('blocks the login, keeps the reason, closes the shop, erases the personal data — and never writes to the ledger', async () => {
    const { service, fake, updateUserById, audit } = setup({ roles: ['merchant'] });
    await service.deleteAccount('u1', { password: 'p', reason: 'fees', comment: '  trop cher  ' });
    expect(updateUserById).toHaveBeenCalledWith('u1', expect.objectContaining({ ban_duration: '876000h' }));
    const write = (table: string, method: string) => fake.queries.find((q) => q.target === table && q.calls.some((c) => c.method === method));
    expect(write('account_deletions', 'insert')!.calls.find((c) => c.method === 'insert')!.args[0]).toMatchObject({ role: 'merchant', reason: 'fees', comment: 'trop cher' });
    expect(write('merchants', 'update')!.calls.find((c) => c.method === 'update')!.args[0]).toMatchObject({ status: 'closed' });
    expect(write('profiles', 'update')!.calls.find((c) => c.method === 'update')!.args[0]).toMatchObject({ full_name: 'Compte supprimé', phone: null, status: 'deleted', transaction_pin_hash: null });
    expect(fake.queries.some((q) => q.target === 'ledger_entries' && q.calls.some((c) => c.method !== 'select' && c.method !== 'eq'))).toBe(false);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'account_deleted' }));
  });
});
