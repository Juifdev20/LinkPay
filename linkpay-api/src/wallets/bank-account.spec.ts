import { BadRequestException } from '@nestjs/common';
import { BANKS, canonicalBankName, formatAccountNumber, holderMatchesOwner, normalizeAccountNumber, validateBankDestination } from './bank-account';

const RIB = '00017000011234567890123';

describe('normalizeAccountNumber', () => {
  it.each([[RIB], ['00017-00001-12345678901-23'], ['00017 00001 12345678901 23'], [' 00017.00001.12345678901.23 ']])('%s → 23 digits', (input) => {
    expect(normalizeAccountNumber(input)).toBe(RIB);
  });
  it.each([[''], ['abc'], ['0001700001123456789012'], ['000170000112345678901234'], ['00017-00001-1234567890A-23'], [undefined], [null], ['+243828497218']])('%p is not a bank account number', (input) => {
    expect(normalizeAccountNumber(input)).toBeNull();
  });
  it('is written XXXXX-XXXXX-XXXXXXXXXXX-XX', () => {
    expect(formatAccountNumber(RIB)).toBe('00017-00001-12345678901-23');
  });
});

describe('canonicalBankName', () => {
  it('gives a known bank its usual name, whatever the writing', () => {
    expect(canonicalBankName('rawbank')).toBe('Rawbank');
    expect(canonicalBankName('  EQUITY   bcdc ')).toBe('Equity BCDC');
    expect(canonicalBankName('equity')).toBe('Equity BCDC');
    expect(canonicalBankName('Fbn bank')).toBe('FBNBank');
    expect(canonicalBankName('tmb')).toBe('TMB (Trust Merchant Bank)');
  });
  it('keeps an unknown bank as typed', () => {
    expect(canonicalBankName('  Banque du Kivu ')).toBe('Banque du Kivu');
  });
  it('lists the banks the owner asked for', () => {
    for (const b of ['Equity BCDC', 'Rawbank', 'FBNBank', 'Access Bank', 'Ecobank', 'Sofibanque', 'BGFIBank']) expect(BANKS).toContain(b);
  });
});

describe('validateBankDestination', () => {
  const ok = { bank: 'rawbank', account_number: '00017 00001 12345678901 23', account_name: '  Amina   Kabongo ' };
  it('returns the clean form', () => {
    expect(validateBankDestination(ok)).toEqual({ bank: 'Rawbank', account_number: '00017-00001-12345678901-23', account_name: 'Amina Kabongo' });
  });
  it('refuses a missing bank', () => {
    expect(() => validateBankDestination({ ...ok, bank: ' ' })).toThrow(BadRequestException);
  });
  it('refuses an account number that is not 23 digits, and says where to find it', () => {
    expect(() => validateBankDestination({ ...ok, account_number: '12345' })).toThrow(/23 chiffres/);
    expect(() => validateBankDestination({ ...ok, account_number: '' })).toThrow(/relevé/);
  });
  it('refuses a missing or silly holder name', () => {
    expect(() => validateBankDestination({ ...ok, account_name: '' })).toThrow(/titulaire/);
    expect(() => validateBankDestination({ ...ok, account_name: '12345' })).toThrow(/titulaire/);
    expect(() => validateBankDestination(undefined)).toThrow(BadRequestException);
  });
  it('accepts a company or a name with accents and apostrophes', () => {
    expect(validateBankDestination({ ...ok, account_name: "Éts N'Dama & Fils" }).account_name).toBe("Éts N'Dama & Fils");
  });
});

describe('holderMatchesOwner', () => {
  it('same person, any order, accents or case', () => {
    expect(holderMatchesOwner('KABONGO Amina', 'Amina Kabongo')).toBe(true);
    expect(holderMatchesOwner('Amina Kabongo Mutombo', 'amina kabongo')).toBe(true);
    expect(holderMatchesOwner('Désiré Mbuyi', 'Desire Mbuyi')).toBe(true);
  });
  it('someone else', () => {
    expect(holderMatchesOwner('Jean Mukendi', 'Amina Kabongo')).toBe(false);
    expect(holderMatchesOwner('Amina Tshala', 'Amina Kabongo')).toBe(false);
  });
  it('a company paid in its own name: only a hint, never a refusal', () => {
    expect(holderMatchesOwner('Boutique Kabongo SARL', 'Amina Kabongo')).toBe(false);
  });
  it('unknown when a name is missing', () => {
    expect(holderMatchesOwner('Amina Kabongo', null)).toBeNull();
    expect(holderMatchesOwner('', 'Amina Kabongo')).toBeNull();
  });
});
