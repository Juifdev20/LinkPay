import { BadRequestException } from '@nestjs/common';
import { SavingsService } from './savings.service';
import { createFakeSupabase, has, RecordedQuery } from '../test-utils/fake-supabase';

function setup(opts: { balances?: any[]; pots?: Record<string, any>; rpcError?: string } = {}) {
  const pots = opts.pots ?? { CDF: { id: 'pot-cdf', currency: 'CDF', round_up_enabled: true } };
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'rpc:savings_pot_balances') return { data: opts.balances ?? [] };
    if (q.target === 'savings_pots') {
      const cur = q.calls.find((c) => c.method === 'eq' && c.args[0] === 'currency')?.args[1];
      return { data: pots[cur] ?? null };
    }
    if (q.target === 'savings_pot_entries') return { data: [{ id: 'e1', type: 'round_up', amount_cents: 300 }] };
    if (q.target === 'rpc:withdraw_from_savings_pot') return opts.rpcError ? { data: null, error: { message: opts.rpcError } } : { data: 400 };
    if (q.target === 'wallets') return { data: { id: 'w1' } };
    return { data: null };
  });
  const pin = { verifyPin: jest.fn(async () => undefined) };
  return { service: new SavingsService(fake.service, pin as any), fake, pin };
}

describe('SavingsService.getMyPot', () => {
  it('takes balances from the database SUM and never downloads the whole entry history', async () => {
    const { service, fake } = setup({ balances: [{ currency: 'CDF', balance_cents: '12345' }] });
    const { pots } = await service.getMyPot('u1');
    expect(pots.find((p) => p.currency === 'CDF')!.balance_cents).toBe(12345);
    const entriesQuery = fake.queries.find((q) => q.target === 'savings_pot_entries')!;
    expect(has(entriesQuery, 'limit', 20)).toBe(true);
    expect(has(entriesQuery, 'order', 'created_at')).toBe(true);
  });

  it('a currency the user never set up comes back empty without creating anything', async () => {
    const { service, fake } = setup();
    const { pots } = await service.getMyPot('u1');
    expect(pots.find((p) => p.currency === 'USD')).toEqual({ currency: 'USD', pot: null, balance_cents: 0, entries: [] });
    expect(fake.queries.some((q) => q.target === 'savings_pots' && has(q, 'insert'))).toBe(false);
  });
});

describe('SavingsService.updateSettings', () => {
  it('refuses a USD round-up step above $100 (it would sweep $9,999 into savings on a $1 payment)', async () => {
    const { service, fake } = setup();
    await expect(service.updateSettings('u1', 'USD', { round_up_increment_cents: 1_000_000 })).rejects.toBeInstanceOf(BadRequestException);
    expect(fake.queries.some((q) => q.target === 'savings_pots' && has(q, 'update'))).toBe(false);
  });

  it('accepts the same number in CDF, where it is only 10 000 FC', async () => {
    const { service } = setup();
    await expect(service.updateSettings('u1', 'CDF', { round_up_increment_cents: 1_000_000 })).resolves.toBeDefined();
  });

  it('refuses an unknown currency', async () => {
    const { service } = setup();
    await expect(service.updateSettings('u1', 'EUR', {})).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('SavingsService.withdraw', () => {
  it('checks the PIN before any money moves', async () => {
    const { service, pin, fake } = setup();
    await service.withdraw('u1', 'CDF', 100, '1234');
    expect(pin.verifyPin).toHaveBeenCalledWith('u1', '1234');
    expect(fake.queries.some((q) => q.target === 'rpc:withdraw_from_savings_pot')).toBe(true);
  });

  it('a wrong PIN stops everything', async () => {
    const { service, pin, fake } = setup();
    pin.verifyPin.mockRejectedValueOnce(new BadRequestException('PIN incorrect'));
    await expect(service.withdraw('u1', 'CDF', 100, '0000')).rejects.toThrow('PIN incorrect');
    expect(fake.queries.some((q) => q.target === 'rpc:withdraw_from_savings_pot')).toBe(false);
  });

  it('says so when the pot does not hold enough', async () => {
    const { service } = setup({ rpcError: 'Insufficient pot balance: has 50, needs 100' });
    await expect(service.withdraw('u1', 'CDF', 100, '1234')).rejects.toThrow('Solde de la tirelire insuffisant');
  });
});
