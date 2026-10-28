export type Currency = 'CDF' | 'USD';

export type VerificationStatus = 'none' | 'pending' | 'approved' | 'rejected' | 'revoked';

export interface ExchangeLimit {
  currency: Currency;
  min_cents: number | null;
  max_cents: number | null;
  daily_max_cents: number | null;
  monthly_max_cents: number | null;
  used_today_cents: number;
  used_month_cents: number;
}

/** What GET /exchange says about the Bureau d'échange for the person using the app. */
export interface ExchangeState {
  /** Their account type may use it (clients, shops, business owners — never employees). */
  eligible: boolean;
  /** The team switched the service on. Until then nobody sees the button. */
  enabled: boolean;
  /** On, with fresh rates, and this account is validated: an exchange can be made right now. */
  available: boolean;
  /** On, but the rates were not refreshed for 24 h: the service waits by itself. */
  paused: boolean;
  quote_seconds: number;
  verification?: { status: VerificationStatus; reason: string | null; requested_at: string | null };
  rates?: { buy: number; sell: number; updated_at: string } | null;
  limits?: Record<Currency, ExchangeLimit>;
}

export interface ExchangeQuote {
  quote_id: string;
  from_currency: Currency;
  to_currency: Currency;
  from_cents: number;
  to_cents: number;
  rate: number;
  expires_at: string;
  seconds: number;
}

export const otherCurrency = (c: Currency): Currency => (c === 'USD' ? 'CDF' : 'USD');

const floorDiv = (a: bigint, b: bigint) => {
  const q = a / b;
  return a % b !== 0n && (a < 0n) !== (b < 0n) ? q - 1n : q;
};

/**
 * What the person receives for `fromCents` of `from`, shown BEFORE they confirm. The very same arithmetic as the
 * server (exchange_compute in migration 088, computeExchange in the API), in BigInt so big amounts never drift:
 *   dollars -> francs at the BUY price, whole francs, rounded down;
 *   francs -> dollars at the SELL price, cents, rounded down.
 * The amount that is really exchanged is the one in the quote the server returns when they press « Continuer ».
 */
export function receivedCents(from: Currency, fromCents: number, rates: { buy: number; sell: number }): { rate: number; to_cents: number } {
  const f = BigInt(Math.max(0, Math.floor(fromCents)));
  if (from === 'USD') {
    const rate = BigInt(Math.round(rates.buy * 100));
    return { rate: rates.buy, to_cents: Number(floorDiv(f * rate, 10_000n) * 100n) };
  }
  const rate = BigInt(Math.round(rates.sell * 100));
  return { rate: rates.sell, to_cents: Number(floorDiv(f * 100n, rate)) };
}

/**
 * The smallest amount of `from` that gives at least `neededCents` of the other currency: « I need 68 000 CDF, how
 * many dollars is that? ». Used by the suggestion shown when a balance is too short for a withdrawal or a send.
 */
export function givenToReceive(from: Currency, neededCents: number, rates: { buy: number; sell: number }): number {
  const rate = BigInt(Math.round((from === 'USD' ? rates.buy : rates.sell) * 100));
  const n = BigInt(Math.max(0, Math.ceil(neededCents)));
  const ceilDiv = (a: bigint, b: bigint) => -floorDiv(-a, b);
  if (from === 'USD') {
    // francs received = floor(cents * rate / 10 000) whole francs >= ceil(needed / 100)  =>  cents >= ceil(k * 10 000 / rate)
    return Number(ceilDiv(ceilDiv(n, 100n) * 10_000n, rate));
  }
  // dollar cents received = floor(francs cents * 100 / rate) >= needed  =>  francs cents >= ceil(needed * rate / 100), whole francs
  return Number(ceilDiv(ceilDiv(n * rate, 100n), 100n) * 100n);
}

/** "1 $US = 2 820 CDF": the price, as people read it. */
export function rateLine(rate: number): string {
  const text = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(rate);
  return `1 $US = ${text} CDF`;
}
