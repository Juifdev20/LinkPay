/**
 * The provider charged the customer SOME amount; we credit the merchant / wallet with the amount WE recorded.
 * They must be the same. A provider that confirms a different amount (a rounding difference, a tampered request,
 * a partial payment) must not result in us crediting the larger figure. If the provider reports no amount at all
 * (the mock provider), there is nothing to compare.
 */
export function confirmedAmountMatches(expectedCents: number, confirmedCents: number | undefined | null): boolean {
  if (confirmedCents === undefined || confirmedCents === null) return true;
  const confirmed = Number(confirmedCents);
  if (!Number.isFinite(confirmed) || confirmed <= 0) return true;
  return confirmed === Number(expectedCents);
}

/** Providers that bill whole currency units cannot charge a fraction: refuse it up front instead of rounding it away. */
export function isWholeCurrencyUnits(amountCents: number): boolean {
  return Number.isInteger(amountCents) && amountCents % 100 === 0;
}
