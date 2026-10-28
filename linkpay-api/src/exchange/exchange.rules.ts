import { BadRequestException, ConflictException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';

export type Currency = 'CDF' | 'USD';

/**
 * Who may use the Bureau d'échange: clients, shops and business owners. Never the employees (cashier, manager,
 * storekeeper, seller, accountant…) nor the ScanLinkPay team (who have no wallet).
 */
export const EXCHANGE_ELIGIBLE_ROLES = ['client', 'merchant', 'enterprise'];

/** The role that counts: an owner "acting as" one of their stores keeps their enterprise rights. */
export function effectiveRole(user: { role?: string | null; acting_as_org_id?: string | null } | null | undefined): string | undefined {
  if (!user?.role) return undefined;
  return user.role === 'merchant' && user.acting_as_org_id ? 'enterprise' : user.role;
}

export const isEligibleRole = (role: string | undefined | null) => !!role && EXCHANGE_ELIGIBLE_ROLES.includes(role);

/** How long a quoted rate is guaranteed. */
export const QUOTE_SECONDS = 60;
/** The rates must be refreshed at least this often, or the service pauses by itself (migration 088 enforces the same). */
export const RATES_MAX_AGE_MS = 24 * 3_600_000;
/** A new rate more than this far from the previous one is probably a typo (28200 for 2820): it needs a second confirmation. */
export const BIG_CHANGE_RATIO = 0.2;
/** Selling more than this much above the buying price is almost certainly a typo too. */
export const WIDE_SPREAD_RATIO = 0.15;

const floorDiv = (a: bigint, b: bigint) => {
  const q = a / b;
  return (a % b !== 0n && (a < 0n) !== (b < 0n)) ? q - 1n : q;
};
const rate100 = (rate: number) => BigInt(Math.round(rate * 100));

export interface Computed {
  rate: number;
  to_cents: number;
  gain_cdf_cents: number;
}

/**
 * What a client gets for `fromCents` of `from`, and ScanLinkPay's gain in CDF cents measured against the market
 * rate. The SAME arithmetic as exchange_compute() in migration 088 (BigInt: no floating-point drift on big amounts),
 * and as linkpay-web/src/lib/exchange.ts which shows it before the client confirms.
 *   USD -> CDF at the BUY rate : whole francs, rounded down.
 *   CDF -> USD at the SELL rate: cents, rounded down.
 */
export function computeExchange(from: Currency, fromCents: number, buy: number, sell: number, market: number): Computed {
  const f = BigInt(fromCents);
  if (from === 'USD') {
    const to = floorDiv(f * rate100(buy), 10_000n) * 100n;
    return { rate: buy, to_cents: Number(to), gain_cdf_cents: Number(floorDiv(f * rate100(market) - to * 100n, 100n)) };
  }
  const to = floorDiv(f * 100n, rate100(sell));
  return { rate: sell, to_cents: Number(to), gain_cdf_cents: Number(floorDiv(f * 100n - to * rate100(market), 100n)) };
}

/** "Fill both rates" helper of the admin page: market rate and a margin in % -> buy and sell, 2 decimals. */
export function ratesFromMarket(market: number, marginPercent: number): { buy: number; sell: number } {
  const m = marginPercent / 100;
  return { buy: Math.round(market * (1 - m) * 100) / 100, sell: Math.round(market * (1 + m) * 100) / 100 };
}

/** "100,00 $US" / "282 000,00 CDF": the same writing as the app (linkpay-web formatCurrency), for the messages the API writes itself. */
export function formatMoney(cents: number, currency: string): string {
  const value = (cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value}\u00a0${currency === 'USD' ? '$US' : currency}`;
}

const err = (E: new (body: any) => HttpException, code: string, message: string, extra: Record<string, any> = {}) =>
  new E({ statusCode: new E({}).getStatus(), code, message, ...extra });

/**
 * What the database function said (RAISE EXCEPTION 'EXCHANGE_…') -> a clear French answer for the client.
 * Returns null for anything unexpected: the caller then lets it surface as a server error.
 */
export function exchangeError(dbMessage: string, ctx: { fromCurrency?: string } = {}): HttpException | null {
  const m = String(dbMessage || '');
  const cur = ctx.fromCurrency || 'CDF';
  const amount = /EXCHANGE_[A-Z]+:(\d+)/.exec(m);
  const cents = amount ? Number(amount[1]) : 0;

  if (/EXCHANGE_DISABLED/.test(m)) return err(ForbiddenException, 'EXCHANGE_DISABLED', "Le Bureau d'échange n'est pas disponible pour le moment.");
  if (/EXCHANGE_RATES_STALE/.test(m)) {
    return err(ConflictException, 'EXCHANGE_PAUSED', "Le Bureau d'échange est momentanément en pause : les taux du jour ne sont pas encore à jour. Réessayez un peu plus tard.");
  }
  if (/EXCHANGE_NOT_VERIFIED/.test(m)) return err(ForbiddenException, 'EXCHANGE_NOT_VERIFIED', "Votre compte doit d'abord être validé par notre équipe pour utiliser le Bureau d'échange.");
  if (/EXCHANGE_MIN:/.test(m)) return err(BadRequestException, 'EXCHANGE_MIN', `Montant minimum : ${formatMoney(cents, cur)}.`, { min_cents: cents });
  if (/EXCHANGE_MAX:/.test(m)) return err(BadRequestException, 'EXCHANGE_MAX', `Montant maximum par échange : ${formatMoney(cents, cur)}.`, { max_cents: cents });
  if (/EXCHANGE_DAILY:/.test(m)) {
    return err(
      BadRequestException,
      'EXCHANGE_DAILY',
      cents > 0 ? `Limite du jour dépassée : il vous reste ${formatMoney(cents, cur)} aujourd'hui.` : "Limite d'échange du jour atteinte. Réessayez demain.",
      { remaining_cents: cents },
    );
  }
  if (/EXCHANGE_MONTHLY:/.test(m)) {
    return err(
      BadRequestException,
      'EXCHANGE_MONTHLY',
      cents > 0 ? `Limite du mois dépassée : il vous reste ${formatMoney(cents, cur)} ce mois-ci.` : "Limite d'échange du mois atteinte.",
      { remaining_cents: cents },
    );
  }
  if (/EXCHANGE_CDF_WHOLE/.test(m)) return err(BadRequestException, 'EXCHANGE_CDF_WHOLE', "Les francs s'échangent par montants entiers, sans centimes.");
  if (/EXCHANGE_TOO_SMALL/.test(m)) return err(BadRequestException, 'EXCHANGE_TOO_SMALL', 'Ce montant est trop petit pour être échangé.');
  if (/EXCHANGE_INVALID_PAIR/.test(m)) return err(BadRequestException, 'EXCHANGE_INVALID_PAIR', 'Choisissez deux devises différentes.');
  if (/EXCHANGE_INVALID_AMOUNT/.test(m)) return err(BadRequestException, 'EXCHANGE_INVALID_AMOUNT', 'Montant invalide.');
  if (/EXCHANGE_QUOTE_EXPIRED/.test(m)) return err(ConflictException, 'EXCHANGE_QUOTE_EXPIRED', 'Le taux garanti a expiré. Un nouveau taux vous est proposé : vérifiez-le avant de confirmer.');
  if (/EXCHANGE_QUOTE_USED/.test(m)) return err(ConflictException, 'EXCHANGE_QUOTE_USED', 'Cet échange a déjà été effectué.');
  if (/EXCHANGE_QUOTE_NOT_FOUND/.test(m)) return err(NotFoundException, 'EXCHANGE_QUOTE_NOT_FOUND', 'Offre introuvable. Recommencez la saisie du montant.');
  if (/EXCHANGE_KEY_REUSED/.test(m)) return err(ConflictException, 'EXCHANGE_KEY_REUSED', "Cette clé d'idempotence a déjà été utilisée pour une autre opération.");
  if (/EXCHANGE_WALLET_NOT_FOUND/.test(m)) return err(NotFoundException, 'EXCHANGE_WALLET_NOT_FOUND', 'Portefeuille introuvable.');
  if (/Insufficient balance/i.test(m)) return err(BadRequestException, 'INSUFFICIENT_BALANCE', `Solde insuffisant en ${cur === 'USD' ? 'dollars' : 'francs'}.`);
  return null;
}
