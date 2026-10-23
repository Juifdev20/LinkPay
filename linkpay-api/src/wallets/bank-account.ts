import { BadRequestException } from '@nestjs/common';

/**
 * Bank accounts of the DR Congo, for withdrawals and merchant settlements that an administrator pays by hand.
 *
 * What is checked here, and what cannot be:
 *  - FORMAT. Since the Banque Centrale du Congo's Instruction n°28 on the standardisation of bank details, a Congolese
 *    account number has 23 digits: bank code (5) + branch code (5) + account number (11) + RIB key (2), written
 *    XXXXX-XXXXX-XXXXXXXXXXX-XX (source: Trust Merchant Bank's notice to its customers, 2017). Spaces and dashes typed by the
 *    customer are accepted and removed.
 *  - NOT checked: the RIB key, and the bank code of each bank — no published table or key algorithm could be reached.
 *    A wrong table would lock real customers out, so only the length and the digits are enforced.
 *  - EXISTENCE of the account. Only the bank knows. When the administrator makes the transfer the bank refuses an unknown
 *    account: the administrator then refuses the withdrawal ("compte introuvable") and the wallet is refunded in full.
 *
 * The web app holds the same list (linkpay-web/src/lib/banks.ts): the API is the authority, the app tells the person at once.
 */
export const ACCOUNT_DIGITS = 23;

export const BANK_DELAY_HOURS = 24;

/** Banks the customer picks from. "Autre banque" (free name) stays possible: a missing bank must not block a customer. */
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

export const OTHER_BANK = 'Autre banque';

const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** "00017 00001 12345678901 23", "00017-00001-12345678901-23" or the bare 23 digits → the 23 digits, else null. */
export function normalizeAccountNumber(raw: unknown): string | null {
  const digits = String(raw ?? '').replace(/[\s.-]/g, '');
  return new RegExp(`^\\d{${ACCOUNT_DIGITS}}$`).test(digits) ? digits : null;
}

/** 23 digits → "XXXXX-XXXXX-XXXXXXXXXXX-XX". */
export function formatAccountNumber(digits: string): string {
  return `${digits.slice(0, 5)}-${digits.slice(5, 10)}-${digits.slice(10, 21)}-${digits.slice(21)}`;
}

/** The bank's usual name when the typed one is a known bank written another way ("equity bcdc", "RAWBANK"), else the typed name. */
export function canonicalBankName(raw: unknown): string {
  const typed = clean(raw);
  const key = fold(typed);
  return BANKS.find((b) => fold(b) === key || fold(b).startsWith(key) && key.length >= 3) ?? typed;
}

/**
 * Checks a bank destination {bank, account_number, account_name} and returns it in its clean form (account number as
 * "XXXXX-XXXXX-XXXXXXXXXXX-XX"). Refuses with a message the customer can act on.
 */
export function validateBankDestination(destination: Record<string, any> | undefined | null): { bank: string; account_number: string; account_name: string } {
  const bank = canonicalBankName(destination?.bank);
  if (bank.length < 2 || bank.length > 60) throw new BadRequestException('Choisissez votre banque.');
  const digits = normalizeAccountNumber(destination?.account_number);
  if (!digits) {
    throw new BadRequestException(
      `Le numéro de compte bancaire doit comporter ${ACCOUNT_DIGITS} chiffres (exemple : 00017-00001-12345678901-23). Vous le trouvez sur votre relevé de compte ou dans l'application de votre banque (RIB).`,
    );
  }
  const holder = clean(destination?.account_name);
  if (holder.length < 3 || holder.length > 100 || !/^[\p{L}\p{N}\s'.,&()/-]+$/u.test(holder) || (holder.match(/\p{L}/gu) ?? []).length < 2) {
    throw new BadRequestException('Saisissez le nom du titulaire du compte, tel qu\'il apparaît à la banque.');
  }
  return { bank, account_number: formatAccountNumber(digits), account_name: holder };
}

/**
 * Does the holder's name look like the name on the ScanLinkPay account? A hint for the administrator, never a refusal:
 * a shop or a company is paid on an account in its own name. Same person = at least two words in common, or the full name
 * contained in the other, ignoring accents, case and the order of the words.
 */
export function holderMatchesOwner(holder: unknown, ownerFullName: unknown): boolean | null {
  const words = (s: unknown) => clean(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  const a = words(holder);
  const b = words(ownerFullName);
  if (!a.length || !b.length) return null;
  const common = a.filter((w) => b.includes(w)).length;
  return common >= Math.min(2, a.length, b.length);
}
