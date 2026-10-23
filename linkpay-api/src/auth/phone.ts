import { randomInt } from 'crypto';

/**
 * Phone numbers of the DRC: +243 followed by 9 digits (81…, 82…, 89…, 97…, 99…).
 * Accepts what people type — "0812345678", "812345678", "243812345678",
 * "+243 812 345 678" — and returns "+243812345678", or null when it isn't one.
 */
export function normalizeDrcPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = String(input).replace(/\D/g, '');
  if (digits.startsWith('00243')) digits = digits.slice(5);
  else if (digits.startsWith('243') && digits.length === 12) digits = digits.slice(3);
  if (digits.length === 10 && digits.startsWith('0')) digits = digits.slice(1);
  if (!/^[1-9]\d{8}$/.test(digits)) return null;
  return `+243${digits}`;
}

/** The 9 national digits as a LIKE pattern tolerant of the spaces older profiles stored ("+243 812 345 678"). */
export function phoneLikePattern(normalized: string): string {
  const d = normalized.slice(-9);
  return `%${d.slice(0, 3)}%${d.slice(3, 6)}%${d.slice(6)}`;
}

/** Same 9 national digits, whatever the format — the final check after the LIKE pre-filter. */
export function samePhone(a: string | null | undefined, b: string): boolean {
  return normalizeDrcPhone(a) === normalizeDrcPhone(b);
}

/** The Supabase Auth email of a phone-only account: a reserved domain (.invalid) nothing is ever sent to. */
export const TECHNICAL_EMAIL_DOMAIN = 'sans-email.scanlinkpay.invalid';
export const technicalEmailFor = (normalized: string) => `t${normalized.replace(/\D/g, '')}@${TECHNICAL_EMAIL_DOMAIN}`;
export const isTechnicalEmail = (email?: string | null) => !!email && email.endsWith(`@${TECHNICAL_EMAIL_DOMAIN}`);

// No 0/O, 1/I/L: the code is read off a screen or a sheet of paper and typed by hand.
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A recovery code like "K7PM-3QX9-T2WA" (12 characters, ~59 bits). */
export function generateRecoveryCode(): string {
  const chars = Array.from({ length: 12 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8).join('')}`;
}

/** What the person typed, reduced to the code itself: case, spaces and dashes don't matter. */
export const canonicalRecoveryCode = (input: string) => String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
