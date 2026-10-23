/**
 * A product's margin: sale price − purchase price, and its share of the sale price ("taux de marque", what a
 * shopkeeper reads as "I keep 20 % of what I sell"). No purchase price → no margin (never shown as 100 %).
 * Same currency only: both prices of a product are in its own currency.
 */
export function marginOf(saleCents: number | null | undefined, costCents: number | null | undefined) {
  if (costCents == null || !saleCents || saleCents <= 0) return null;
  const cents = saleCents - costCents;
  return { cents, percent: Math.round((cents / saleCents) * 1000) / 10 };
}

/** "12,5 %" — French format. */
export const formatPercent = (p: number) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(p)} %`;
