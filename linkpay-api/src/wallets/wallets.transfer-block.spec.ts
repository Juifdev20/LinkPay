import { BadRequestException } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { createFakeSupabase, has, RecordedQuery } from '../test-utils/fake-supabase';

const DTO = { recipient_wallet_number: 'SLP-000002', amount_cents: 10000, currency: 'CDF', pin: '1234' };

function setup(opts: { merchant?: any; org?: any } = {}) {
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'transfers') return { data: null };
    if (q.target === 'wallets') {
      if (has(q, 'eq', 'user_id', 'sender-user')) return { data: { id: 'ws', status: 'ACTIVE', user_id: 'sender-user' } };
      return { data: { id: 'wr', user_id: 'recipient-user', wallet_number: 'SLP-000002', status: 'ACTIVE' } };
    }
    if (q.target === 'merchants') return { data: opts.merchant ?? null };
    if (q.target === 'organizations') return { data: opts.org ?? null };
    if (q.target === 'profiles') return { data: { full_name: 'Jean Kambale' } };
    return { data: null };
  });
  const verifyPin = jest.fn(async () => undefined);
  const service = new WalletsService(
    fake.service, {} as any, { create: jest.fn() } as any, { get: (_k: string, d?: any) => d } as any,
    { verifyPin } as any,
    // Stop right after the checks under test: limits are the next thing that runs.
    { getRule: async () => { throw new Error('REACHED_LIMITS'); } } as any,
    { log: jest.fn() } as any, {} as any, {} as any, { assessOutflow: jest.fn() } as any,
  );
  return { service, verifyPin, fake };
}

describe('WalletsService.transfer — no transfers into business wallets', () => {
  it("refuses a transfer to a store's wallet, before asking for the PIN or touching money", async () => {
    const { service, verifyPin, fake } = setup({ merchant: { name: 'Boutique Mukendi', logo_url: null } });
    const err: any = await service.transfer('sender-user', DTO, 'k1').catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toMatch(/compte marchand/);
    expect(err.message).toMatch(/facture/);
    expect(verifyPin).not.toHaveBeenCalled();
    expect(fake.queries.some((q) => q.target === 'transfers' && has(q, 'insert'))).toBe(false);
  });

  it('refuses a transfer to an enterprise owner too', async () => {
    const { service } = setup({ org: { name: 'Super Marché Kin' } });
    await expect(service.transfer('sender-user', DTO, 'k1')).rejects.toThrow(/compte marchand/);
  });

  it('lets a plain client receive a transfer (goes on to the limits check)', async () => {
    const { service, verifyPin } = setup();
    await expect(service.transfer('sender-user', DTO, 'k1')).rejects.toThrow('REACHED_LIMITS');
    expect(verifyPin).toHaveBeenCalled();
  });

  it('internal flows (tontines) may still pay a member who happens to own a store', async () => {
    const { service } = setup({ merchant: { name: 'Boutique' } });
    await expect(
      service.transfer('sender-user', DTO, 'k1', { skipPinVerification: true, allowBusinessRecipient: true }),
    ).rejects.toThrow('REACHED_LIMITS');
  });
});

describe('WalletsService.lookupWallet', () => {
  it('flags a store owner as not accepting transfers, whatever their wallet number looks like', async () => {
    // A plain "SLP-" number (not "-MER-"): the account became a merchant after the wallet was created.
    const { service } = setup({ merchant: { name: 'Boutique Mukendi', logo_url: 'x.png' } });
    await expect(service.lookupWallet('SLP-000002')).resolves.toMatchObject({
      is_merchant: true, accepts_transfers: false, display_name: 'Boutique Mukendi',
    });
  });

  it('accepts transfers for a plain client and masks their name', async () => {
    const { service } = setup();
    await expect(service.lookupWallet('SLP-000002')).resolves.toMatchObject({
      is_merchant: false, accepts_transfers: true, display_name: 'Jean K.',
    });
  });
});
