import { BadRequestException } from '@nestjs/common';
import { SettlementsService } from './settlements.service';
import { createFakeSupabase, has } from '../test-utils/fake-supabase';

describe('SettlementsService.updateSettlementStatus', () => {
  it('only moves forward from the expected previous status', async () => {
    const fake = createFakeSupabase(() => ({ data: { id: 's1', status: 'COMPLETED' } }));
    await new SettlementsService(fake.service).updateSettlementStatus('s1', 'COMPLETED');
    const update = fake.queries.find((q) => q.target === 'settlements')!;
    expect(has(update, 'eq', 'status', 'PROCESSING')).toBe(true);
  });

  it('refuses a move that does not apply (e.g. reopening a paid settlement)', async () => {
    const fake = createFakeSupabase(() => ({ data: null, error: { message: 'no rows' } }));
    await expect(new SettlementsService(fake.service).updateSettlementStatus('s1', 'PROCESSING')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unknown statuses', async () => {
    const fake = createFakeSupabase(() => undefined);
    await expect(new SettlementsService(fake.service).updateSettlementStatus('s1', 'PENDING')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fails a settlement through fail_settlement so its transactions are released', async () => {
    const fake = createFakeSupabase((q) => (q.target === 'rpc:fail_settlement' ? { data: { id: 's1', status: 'FAILED' } } : undefined));
    await new SettlementsService(fake.service).updateSettlementStatus('s1', 'FAILED', 'numéro invalide');
    const rpc = fake.queries.find((q) => q.target === 'rpc:fail_settlement')!;
    expect(rpc.calls[0].args[0]).toEqual({ p_settlement_id: 's1', p_notes: 'numéro invalide' });
  });
});
