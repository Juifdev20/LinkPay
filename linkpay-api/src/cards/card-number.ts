import { randomBytes, randomInt } from 'crypto';

/**
 * ISO/IEC 7812 issuer identification number of ScanLinkPay cards. A "9" major industry identifier is
 * reserved for national assignments, so it never collides with a bank network (4, 5, 2, 3, 6…); 243 is
 * the DR Congo calling code. 6 digits + 9 account digits + 1 Luhn check digit = 16 digits.
 */
export const CARD_IIN = '924300';

/** Luhn check digit (ISO/IEC 7812) for the digits that come before it. */
export function luhnCheckDigit(body: string): number {
  let sum = 0;
  [...body].reverse().forEach((d, i) => {
    let n = Number(d);
    if (i % 2 === 0) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  });
  return (10 - (sum % 10)) % 10;
}

export function isValidCardNumber(value: string): boolean {
  return /^\d{16}$/.test(value) && luhnCheckDigit(value.slice(0, 15)) === Number(value[15]);
}

/** A fresh 16-digit number. The 9 account digits are random (not a counter) so a number can't be guessed from another. */
export function generateCardNumber(random: (max: number) => number = (max) => randomInt(max)): string {
  let account = '';
  for (let i = 0; i < 9; i++) account += String(random(10));
  const body = CARD_IIN + account;
  return body + luhnCheckDigit(body);
}

/** "9243 0012 3456 7895" — what is printed, and what a person types. */
export function formatCardNumber(value: string): string {
  return value.replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** Spaces and dashes a person may type are ignored. */
export function normalizeCardNumber(input: string): string {
  return String(input ?? '').replace(/[\s-]/g, '');
}

export function maskCardNumber(value: string | null | undefined): string {
  return value && value.length === 16 ? `•••• •••• •••• ${value.slice(12)}` : '';
}

// Crockford base32: no I, L, O, U — nothing that reads as another character when a QR link is typed by hand.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Opaque token carried by the QR code: 12 characters = 60 random bits. It designates the card and unlocks nothing by itself. */
export function generateQrToken(bytes: Buffer = randomBytes(12)): string {
  let out = '';
  for (let i = 0; i < 12; i++) out += ALPHABET[bytes[i] % 32];
  return out;
}

/** What the QR code is allowed to contain. Anything else is not one of our cards. */
export function isQrToken(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{12}$/.test(value);
}

/**
 * The name printed on the card (ISO/IEC 7813): capital letters without accents, at most 26 characters.
 * When the full name doesn't fit, middle names become initials, then the end is cut.
 */
export function holderNameFor(fullName: string | null | undefined, email?: string | null): string {
  const clean = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z '\-.]/g, ' ').replace(/\s+/g, ' ').trim();
  let name = clean(fullName || '') || clean((email || '').split('@')[0].replace(/[._\d]+/g, ' ')) || 'TITULAIRE';
  if (name.length > 26) {
    const parts = name.split(' ');
    if (parts.length > 2) name = [parts[0], ...parts.slice(1, -1).map((p) => `${p[0]}.`), parts[parts.length - 1]].join(' ');
  }
  return name.slice(0, 26).trim();
}

/** "Amina K." — all a merchant ever learns about the person they charge. */
export function publicHolderName(fullName: string | null | undefined): string {
  const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Client ScanLinkPay';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** Last day of the month, `years` years from `from`: a card is valid "until MM/YY" included. */
export function expiryFor(from: Date, years: number): string {
  const d = new Date(Date.UTC(from.getUTCFullYear() + years, from.getUTCMonth() + 1, 0));
  return d.toISOString().slice(0, 10);
}

export function formatExpiry(isoDate: string | null | undefined): string {
  if (!isoDate) return '';
  return `${isoDate.slice(5, 7)}/${isoDate.slice(2, 4)}`;
}

export function isExpired(isoDate: string | null | undefined, now = new Date()): boolean {
  return !!isoDate && isoDate < now.toISOString().slice(0, 10);
}
