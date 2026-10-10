import { BadRequestException } from '@nestjs/common';
import { WalletsService } from '../wallets/wallets.service';
import { PaymentsService } from './payments.service';

// The check runs before anything else is touched, so these calls need no database: `this` is empty on purpose.
// A call that PASSES the check then fails on the empty `this` with a TypeError — which proves it got that far.
const topup = (operator: string, phone: string, method = 'mobile_money') =>
  (WalletsService.prototype.initiateTopup as any).call({}, 'u1', 500000, 'CDF', 'key-1', method, operator, phone);
const invoice = (operator: string, phone: string) =>
  (PaymentsService.prototype.createPayment as any).call({}, { link_token: 't', idempotency_key: 'k', payment_method: 'mobile_money', mobile_money_operator: operator, customer: { phone } });
const withdrawal = (operator: string, phone: string) =>
  (WalletsService.prototype.requestWithdrawal as any).call({}, 'u1', { amount_cents: 100000, currency: 'CDF', channel: 'mobile_money', destination: { operator, phone }, pin: '1234' }, 'key-2');

describe('a number of another network never starts a payment', () => {
  it.each([['top-up', topup], ['invoice payment', invoice], ['withdrawal', withdrawal]])('%s: Airtel chosen, M-Pesa number → refused with the reason', async (_n, call) => {
    await expect((call as any)('airtel', '0828497218')).rejects.toThrow(/numéro M-Pesa \(Vodacom\), pas Airtel Money/);
    await expect((call as any)('airtel', '0828497218')).rejects.toBeInstanceOf(BadRequestException);
  });
  it.each([['top-up', topup], ['invoice payment', invoice], ['withdrawal', withdrawal]])('%s: a malformed number is refused', async (_n, call) => {
    await expect((call as any)('airtel', '12345')).rejects.toThrow(/invalide/);
  });
  it.each([['top-up', topup], ['invoice payment', invoice], ['withdrawal', withdrawal]])('%s: the right network goes on past the check', async (_n, call) => {
    await expect((call as any)('airtel', '+243 97 345 6789')).rejects.toBeInstanceOf(TypeError);
  });
  it('a card top-up has no number to check', async () => {
    await expect(topup('airtel', '', 'card')).rejects.toBeInstanceOf(TypeError);
  });
});
