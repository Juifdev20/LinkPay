import { ExpenseTrackerService } from './expense-tracker.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

type Answers = { existing?: any; insert?: { data?: any; error?: any }[] };

function setup(answers: Answers) {
  const inserts = [...(answers.insert ?? [{ data: { id: 'e-new' } }])];
  let lookups = 0;
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'expense_reports') return { data: { id: 'r1', user_id: 'u1', status: 'open' } };
    if (q.target === 'expense_entries') {
      if (q.calls.some((c) => c.method === 'insert')) return inserts.shift() ?? { data: { id: 'e-new' } };
      lookups += 1;
      // First lookup = before inserting; later ones = after a duplicate was refused.
      return { data: lookups === 1 ? answers.existing ?? null : { id: 'e-first', client_ref: 'c1' } };
    }
    return { data: null };
  });
  const service = new ExpenseTrackerService(fake.service, {} as any, {} as any, {} as any, {} as any);
  jest.spyOn(service as any, 'assertNotReadOnly').mockResolvedValue({ plan: 'pro' });
  const insertOf = () => fake.queries.find((q) => q.target === 'expense_entries' && q.calls.some((c) => c.method === 'insert'));
  return { service, fake, insertOf };
}

const ref = '9b2f6a1e-1c4d-4b8e-9f00-2a7c3d4e5f60';

describe('Mes dépenses — notes written offline', () => {
  it('a note already received (same client_ref) comes back as is, never twice', async () => {
    const { service, insertOf } = setup({ existing: { id: 'e-first', client_ref: ref } });
    const r = await service.addEntry('u1', 'r1', { amount_cents: 5000, client_ref: ref });
    expect(r).toEqual({ id: 'e-first', client_ref: ref });
    expect(insertOf()).toBeUndefined();
  });

  it('a new offline note keeps its id and the time it was written', async () => {
    const { service, insertOf } = setup({});
    const notedAt = new Date(Date.now() - 2 * 24 * 3600_000).toISOString();
    await service.addEntry('u1', 'r1', { amount_cents: 5000, description: 'Taxi', client_ref: ref, noted_at: notedAt });
    const row = insertOf()!.calls.find((c) => c.method === 'insert')!.args[0];
    expect(row).toMatchObject({ client_ref: ref, created_at: notedAt, amount_cents: 5000, user_id: 'u1' });
  });

  it('a time in the future or older than 30 days is ignored (server time)', async () => {
    for (const notedAt of [new Date(Date.now() + 3600_000).toISOString(), new Date(Date.now() - 40 * 24 * 3600_000).toISOString()]) {
      const { service, insertOf } = setup({});
      await service.addEntry('u1', 'r1', { amount_cents: 5000, client_ref: ref, noted_at: notedAt });
      expect(insertOf()!.calls.find((c) => c.method === 'insert')!.args[0].created_at).toBeUndefined();
    }
  });

  it('two sends that cross: the unique index refuses the second, the first is returned', async () => {
    const { service } = setup({ insert: [{ error: { code: '23505', message: 'duplicate key value violates unique constraint' } }] });
    const r = await service.addEntry('u1', 'r1', { amount_cents: 5000, client_ref: ref });
    expect(r).toEqual({ id: 'e-first', client_ref: 'c1' });
  });

  it('migration 073 not run yet: the note is still recorded, without client_ref', async () => {
    const { service, fake } = setup({ insert: [{ error: { code: '42703', message: 'column "client_ref" does not exist' } }, { data: { id: 'e-new' } }] });
    const r = await service.addEntry('u1', 'r1', { amount_cents: 5000, client_ref: ref });
    expect(r).toEqual({ id: 'e-new' });
    const inserts = fake.queries.filter((q) => q.target === 'expense_entries' && q.calls.some((c) => c.method === 'insert'));
    expect(inserts[1].calls.find((c) => c.method === 'insert')!.args[0].client_ref).toBeUndefined();
  });
});
