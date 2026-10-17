import { ForbiddenException, HttpException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { CashierPinService } from './cashier-pin.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

const hash = bcrypt.hashSync('4821', 4);
const STAFF = [
  { user_id: 'boss-deputy', pos_pin_hash: hash, pos_pin_locked_until: null, deactivated_at: null },
  { user_id: 'fired', pos_pin_hash: bcrypt.hashSync('7777', 4), pos_pin_locked_until: null, deactivated_at: '2026-06-01T00:00:00Z' },
];

function make(attempts?: any) {
  const fake = createFakeSupabase((q: RecordedQuery) => (q.target === 'organization_staff' ? { data: STAFF } : { data: null }));
  return new CashierPinService(fake.service, attempts);
}

describe('supervisor PIN (authorizing a colleague\'s void)', () => {
  it('accepts a colleague\'s PIN and clears the cashier\'s attempt counter', async () => {
    const attempts = { reserve: jest.fn(async () => ({ justLocked: false })), recordSuccess: jest.fn(async () => undefined) };
    expect(await make(attempts).verifyOtherStaffPin('o1', '4821', 'cashier')).toBe('boss-deputy');
    expect(attempts.reserve).toHaveBeenCalledWith('pos-supervisor:cashier');
    expect(attempts.recordSuccess).toHaveBeenCalledWith('pos-supervisor:cashier');
  });

  it('a wrong PIN counts against the cashier at the till (and is refused)', async () => {
    const attempts = { reserve: jest.fn(async () => ({ justLocked: false })), recordSuccess: jest.fn() };
    await expect(make(attempts).verifyOtherStaffPin('o1', '0000', 'cashier')).rejects.toBeInstanceOf(ForbiddenException);
    expect(attempts.recordSuccess).not.toHaveBeenCalled();
  });

  it('once the cashier has used up their tries they are locked out, even with the right PIN', async () => {
    const attempts = { reserve: jest.fn(async () => { throw new HttpException('Trop de tentatives', 429); }), recordSuccess: jest.fn() };
    await expect(make(attempts).verifyOtherStaffPin('o1', '4821', 'cashier')).rejects.toMatchObject({ status: 429 });
  });

  it('the PIN of an employee whose access was removed no longer authorizes anything', async () => {
    await expect(make().verifyOtherStaffPin('o1', '7777', 'cashier')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
