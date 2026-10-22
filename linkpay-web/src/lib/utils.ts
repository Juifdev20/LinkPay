import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "2 950,00 CDF" / "5,12 $US" — the currency written as in the app's design (CDF, $US), not the locale's "FC". */
export function formatCurrency(cents: number, currency: string = 'CDF'): string {
  const value = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
  const symbol = currency === 'USD' ? '$US' : currency;
  return `${value}\u00a0${symbol}`;
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
}

export function formatShortDate(date: string | Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date));
}

/**
 * Validates a post-login/register `?redirect=` target before navigating to
 * it — never follow it if it isn't a same-app internal path, or an
 * attacker-crafted link (e.g. `?redirect=//evil.com` or
 * `?redirect=https://evil.com`) could send a freshly authenticated user
 * somewhere else entirely. Falls back to `/dashboard`.
 */
export function safeRedirect(target: string | null): string {
  if (!target) return '/dashboard';
  if (!target.startsWith('/') || target.startsWith('//') || target.includes('://')) {
    return '/dashboard';
  }
  return target;
}

/** « 0 commerçant », « 1 commerçant », « 3 commerçants » — never « commerçant(s) ». */
export function countLabel(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n > 1 ? many : one}`;
}
