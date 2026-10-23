/**
 * Bank accounts of the DR Congo, for withdrawals to a bank. A withdrawal to a bank is sent BY HAND by an administrator
 * (FlexPaie has no API to send money out) and is promised within BANK_DELAY_HOURS.
 *
 * Since the Banque Centrale du Congo's Instruction n°28 an account number has 23 digits: bank code (5) + branch code (5) +
 * account number (11) + RIB key (2), written XXXXX-XXXXX-XXXXXXXXXXX-XX. Only the length and the digits are checked: no table of
 * bank codes or key algorithm could be reached, and a wrong table would lock real customers out. Whether the account EXISTS
 * is known to the bank only — the administrator finds out when making the transfer and then refuses the withdrawal.
 * The API holds the same list and rules and is the authority (linkpay-api/src/wallets/bank-account.ts): keep both identical.
 */
export const ACCOUNT_DIGITS = 23;
export const BANK_DELAY_HOURS = 24;

export const BANKS: string[] = [
  'Equity BCDC',
  'Rawbank',
  'TMB (Trust Merchant Bank)',
  'FBNBank',
  'Access Bank',
  'Ecobank',
  'Sofibanque',
  'BGFIBank',
  'Afriland First Bank',
  'Bank of Africa (BOA)',
  'UBA',
  'Advans Banque Congo',
  'Citibank',
];

/** Value of the bank menu for a bank that is not in the list (the person then types its name). */
export const OTHER_BANK = '__autre__';

/** Keeps the digits, at most 23, and writes them XXXXX-XXXXX-XXXXXXXXXXX-XX while the person types. */
export function formatAccountInput(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, ACCOUNT_DIGITS);
  const parts = [d.slice(0, 5), d.slice(5, 10), d.slice(10, 21), d.slice(21)].filter(Boolean);
  return parts.join('-');
}

export const accountDigits = (formatted: string): string => formatted.replace(/\D/g, '');

export const isAccountComplete = (formatted: string): boolean => accountDigits(formatted).length === ACCOUNT_DIGITS;

/** A holder's name: at least 3 characters, two letters. */
export const isHolderName = (name: string): boolean => name.trim().length >= 3 && (name.match(/\p{L}/gu) ?? []).length >= 2;
