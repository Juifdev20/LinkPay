import airtelLogo from '@/assets/partners/airtel-money.png';
import orangeLogo from '@/assets/partners/orange-money.png';
import mpesaLogo from '@/assets/partners/m-pesa.png';

/**
 * Mobile Money numbers of the DR Congo: +243 then 9 digits; the first two digits (08x / 09x with the national 0) name
 * the network and there is no number portability. The API holds the same table and is the authority (it refuses a
 * number of another network than the chosen one): this copy tells the person at once, while they type.
 * Keep both tables identical (linkpay-api/src/payments/mobile-money.ts).
 *
 * A prefix that is not in the table is NOT refused: the payment provider is the last judge, and an incomplete table
 * must not lock real customers out.
 */
export type OperatorId = 'airtel' | 'orange' | 'vodacom';

export interface MobileMoneyOperator {
  id: OperatorId;
  /** Full name, for sentences ("via M-Pesa (Vodacom)"). */
  label: string;
  /** Short name under the logo. */
  short: string;
  logo: string;
  prefixes: string[];
  /** A number typed as an example in the field. */
  example: string;
}

/** The operators offered to the person, in display order. */
export const MOBILE_MONEY_OPERATORS: MobileMoneyOperator[] = [
  { id: 'airtel', label: 'Airtel Money', short: 'Airtel', logo: airtelLogo, prefixes: ['97', '98', '99'], example: '997 345 678' },
  { id: 'orange', label: 'Orange Money', short: 'Orange', logo: orangeLogo, prefixes: ['84', '85', '89', '80'], example: '843 456 789' },
  { id: 'vodacom', label: 'M-Pesa (Vodacom)', short: 'M-Pesa', logo: mpesaLogo, prefixes: ['81', '82', '83'], example: '823 456 789' },
];

/** Networks that exist but are not offered (a number of theirs is recognised, so the message can name them). */
const OTHER_NETWORKS = [{ label: 'Africell', prefixes: ['90', '91'] }];

export const operatorById = (id: string): MobileMoneyOperator | undefined => MOBILE_MONEY_OPERATORS.find((o) => o.id === id);

/**
 * What the person typed or pasted → the 9 national digits ("+243 828 497 218", "0828497218", "00243…" all give
 * "828497218"). Never more than 9 digits.
 */
export function toNationalDigits(input: string): string {
  const typed = String(input ?? '').trim();
  let d = typed.replace(/\D/g, '');
  if (d.startsWith('00243')) d = d.slice(5);
  // "+243…" is recognised as soon as it is typed; a bare "243…" only once it is clearly longer than a national number.
  else if (d.startsWith('243') && (typed.startsWith('+') || d.length > 9)) d = d.slice(3);
  else if (d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 9);
}

/** "828497218" → "828 497 218" (progressive: "82", "828 4"…). */
export function groupNational(digits: string): string {
  return digits.replace(/(\d{3})(?=\d)/g, '$1 ');
}

/** "828497218" → "+243 828 497 218", for sentences. */
export function displayPhone(digits: string): string {
  return `+243\u00A0${groupNational(digits).replace(/ /g, '\u00A0')}`; // never broken across two lines
}

/** What goes to the API. */
export const toApiPhone = (digits: string): string => `+243${digits}`;

export type NumberCheck =
  | { state: 'empty' }
  | { state: 'incomplete' }
  | { state: 'bad_start'; message: string }
  | { state: 'mismatch'; message: string; detected: OperatorId | null; detectedLabel: string }
  | { state: 'ok'; unknownPrefix: boolean };

/** Which of OUR operators a prefix belongs to (null when it is another network, or unknown). */
function ownOperatorOfPrefix(prefix: string): MobileMoneyOperator | undefined {
  return MOBILE_MONEY_OPERATORS.find((o) => o.prefixes.includes(prefix));
}

/** Compares what was typed with the chosen operator, as early as the prefix is known (two digits). */
export function checkNumber(operator: string, digits: string): NumberCheck {
  if (!digits) return { state: 'empty' };
  if (!/^[89]/.test(digits)) {
    return { state: 'bad_start', message: 'Un numéro mobile congolais commence par 8 ou 9 après +243 (ex. 0828 497 218).' };
  }
  if (digits.length >= 2) {
    const prefix = digits.slice(0, 2);
    const chosen = operatorById(operator);
    const own = ownOperatorOfPrefix(prefix);
    if (own && chosen && own.id !== chosen.id) {
      return { state: 'mismatch', detected: own.id, detectedLabel: own.label, message: `Ce numéro est un numéro ${own.label}, pas ${chosen.label}.` };
    }
    const other = OTHER_NETWORKS.find((n) => n.prefixes.includes(prefix));
    if (other && chosen) {
      return { state: 'mismatch', detected: null, detectedLabel: other.label, message: `Ce numéro est un numéro ${other.label}, pas ${chosen.label}. Ce réseau n'est pas encore pris en charge.` };
    }
    if (digits.length === 9) return { state: 'ok', unknownPrefix: !own && !other };
  }
  return { state: 'incomplete' };
}

/** True when the number can be sent. */
export const isNumberReady = (operator: string, digits: string): boolean => checkNumber(operator, digits).state === 'ok';
