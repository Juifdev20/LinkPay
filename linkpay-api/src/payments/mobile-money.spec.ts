import { BadRequestException } from '@nestjs/common';
import { assertNumberMatchesOperator, explainMobileMoneyRefusal, mobileMoneyFailedAdvice, nationalNumber, operatorOfNumber } from './mobile-money';

describe('nationalNumber', () => {
  it.each([['+243 828 497 218'], ['0828497218'], ['243828497218'], ['828497218'], ['00243828497218'], ['+243-828-497-218'], ['(0828) 497 218']])('%s → 828497218', (input) => {
    expect(nationalNumber(input)).toBe('828497218');
  });
  it.each([[''], ['abc'], ['+33612345678'], ['82849721'], ['08284972189'], ['728497218'], [undefined], [null], ['+243 82 849 72 18 9']])('%p is not a Congolese mobile number', (input) => {
    expect(nationalNumber(input)).toBeNull();
  });
});

describe('operatorOfNumber', () => {
  it.each([
    ['0812345678', 'vodacom'], ['0823456789', 'vodacom'], ['0833456789', 'vodacom'],
    ['0843456789', 'orange'], ['0853456789', 'orange'], ['0893456789', 'orange'], ['0803456789', 'orange'],
    ['0973456789', 'airtel'], ['0983456789', 'airtel'], ['0993456789', 'airtel'],
    ['0903456789', 'africell'], ['0913456789', 'africell'],
  ])('%s is %s', (phone, op) => expect(operatorOfNumber(phone)).toBe(op));
  it('an unknown prefix is simply unknown (never guessed)', () => {
    expect(operatorOfNumber('0863456789')).toBeNull();
    expect(operatorOfNumber('0953456789')).toBeNull();
  });
});

describe('assertNumberMatchesOperator', () => {
  it('accepts a number of the chosen network, in any writing', () => {
    expect(() => assertNumberMatchesOperator('vodacom', '+243 828 497 218')).not.toThrow();
    expect(() => assertNumberMatchesOperator('airtel', '0973456789')).not.toThrow();
    expect(() => assertNumberMatchesOperator('orange', '243893456789')).not.toThrow();
  });
  it('refuses a number of ANOTHER network and says which one it is', () => {
    expect(() => assertNumberMatchesOperator('airtel', '0828497218')).toThrow(/numéro M-Pesa \(Vodacom\), pas Airtel Money/);
    expect(() => assertNumberMatchesOperator('vodacom', '0973456789')).toThrow(/numéro Airtel Money, pas M-Pesa/);
    expect(() => assertNumberMatchesOperator('orange', '0903456789')).toThrow(/Africell/);
    expect(() => assertNumberMatchesOperator('airtel', '0828497218')).toThrow(BadRequestException);
  });
  it('refuses a malformed number whatever the operator', () => {
    expect(() => assertNumberMatchesOperator('airtel', '12345')).toThrow(/invalide/);
    expect(() => assertNumberMatchesOperator(undefined, '12345')).toThrow(/invalide/);
  });
  it('does not lock out a prefix it does not know, nor compare when no operator is named', () => {
    expect(() => assertNumberMatchesOperator('airtel', '0863456789')).not.toThrow();
    expect(() => assertNumberMatchesOperator(undefined, '0828497218')).not.toThrow();
    expect(() => assertNumberMatchesOperator('mtn', '0828497218')).not.toThrow();
  });
});

describe('explainMobileMoneyRefusal', () => {
  const airtel = '0973456789';
  it.each([
    'Insufficient funds',
    'Solde insuffisant',
    'The balance is not enough',
    'Fonds insuffisants sur le compte',
  ])('"%s" → says the balance is the cause, and names the operator', (said) => {
    const out = explainMobileMoneyRefusal(said, airtel);
    expect(out).toMatch(/^Solde insuffisant/);
    expect(out).toContain('Airtel Money');
  });

  it('recognises a wrong PIN, a limit, an unknown number and a busy network', () => {
    expect(explainMobileMoneyRefusal('Wrong PIN entered', airtel)).toMatch(/code PIN/);
    expect(explainMobileMoneyRefusal('Transaction limit exceeded', airtel)).toMatch(/dépasse la limite/);
    expect(explainMobileMoneyRefusal('Subscriber not registered', airtel)).toMatch(/pas reconnu/);
    expect(explainMobileMoneyRefusal('Request timeout', airtel)).toMatch(/occupé/);
  });

  it("does not blame the payer's balance when the provider talks about the merchant's own account", () => {
    expect(explainMobileMoneyRefusal('Solde marchand insuffisant', airtel)).toBe('Solde marchand insuffisant');
  });

  it('never calls the minimum amount a "limit": the provider\'s own sentence is already the right one', () => {
    const said = 'Le montant est inférieur au montant minimal pour le CDF';
    expect(explainMobileMoneyRefusal(said, airtel)).toBe(said);
  });

  it('passes an unrecognised French sentence through, and gives advice when the provider said nothing', () => {
    expect(explainMobileMoneyRefusal('Opération non autorisée pour ce marchand', airtel)).toBe('Opération non autorisée pour ce marchand');
    expect(explainMobileMoneyRefusal('', '0813456789')).toContain('M-Pesa (Vodacom)');
  });

  it('uses a generic account name when the number is of no known network', () => {
    expect(explainMobileMoneyRefusal('insufficient funds', '0863456789')).toContain('compte Mobile Money');
  });
});

describe('mobileMoneyFailedAdvice', () => {
  it('lists the usual causes, says nothing was debited, and names the operator of the number', () => {
    const out = mobileMoneyFailedAdvice('0823456789');
    expect(out).toContain('M-Pesa (Vodacom)');
    expect(out).toContain('Aucun montant n\'a été débité');
    expect(out).toMatch(/solde.*PIN.*numéro/s);
  });
});
