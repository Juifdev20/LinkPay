/**
 * The two kinds of business ScanLinkPay is built for (organizations.sector):
 *  - 'supermarche': supermarkets AND food shops — one sector, sold at the till (Caisse, thermal ticket);
 *  - 'electronique': phones, computers, accessories — sold in Ventes, with IMEI / serial / warranty.
 * 'alimentation' was a third sector until migration 076 folded it into 'supermarche'; an organization not migrated
 * yet is read as a supermarket.
 */
export const isSupermarket = (sector?: string | null) => sector === 'supermarche' || sector === 'alimentation';

/** "Supermarché & alimentation" / "Électronique", for screens that show the sector. */
export const sectorLabel = (sector?: string | null) =>
  isSupermarket(sector) ? 'Supermarché & alimentation' : sector === 'electronique' ? 'Électronique' : sector || '—';
