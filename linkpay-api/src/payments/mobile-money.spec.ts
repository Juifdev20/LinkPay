import { BadRequestException } from '@nestjs/common';
import { assertNumberMatchesOperator, nationalNumber, operatorOfNumber } from './mobile-money';

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
