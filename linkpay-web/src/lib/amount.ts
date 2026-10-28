/**
 * What a person types in an amount field, kept to a valid amount while they type.
 *
 * - Whole units (francs, Mobile Money): digits only, no leading zero.
 * - With cents (dollars moved inside ScanLinkPay): digits, ONE separator ("," or "." — the phone's numeric keyboard
 *   offers whichever the language has) and at most two decimals. The value is kept with a dot ("12.5").
 *
 * The same rules everywhere an amount is typed, so a field never accepts "12,,5", "1e3" or "-5".
 */
export function cleanAmount(raw: string, decimals = false): string {
  const text = raw.replace(/\s/g, '').replace(',', '.');
  if (!decimals) return text.replace(/\D/g, '').replace(/^0+/, '').slice(0, 9);
  const [whole = '', ...rest] = text.replace(/[^\d.]/g, '').split('.');
  const intPart = whole.replace(/^0+(?=\d)/, '').slice(0, 9);
  if (rest.length === 0) return intPart;
  return `${intPart || '0'}.${rest.join('').slice(0, 2)}`;
}

/** "12500.5" -> "12 500,5": grouped thousands, comma decimals, a trailing separator kept while typing ("12 500,"). */
export function showAmount(value: string): string {
  const [whole, frac] = value.split('.');
  const grouped = (whole || '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return frac === undefined ? grouped : `${grouped},${frac}`;
}

/** "12.5" -> 1250 cents. Exact: no floating-point arithmetic on the value. */
export function amountToCents(value: string): number {
  if (!value) return 0;
  const [whole, frac = ''] = value.split('.');
  return (parseInt(whole || '0', 10) || 0) * 100 + (parseInt((frac + '00').slice(0, 2), 10) || 0);
}

/** 1250 -> "12.5", 28200000 -> "282000": the value an amount field holds for an amount in cents. */
export function centsToAmount(cents: number): string {
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}
