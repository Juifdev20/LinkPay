/**
 * D'une vente ScanLinkPay (ticket de caisse payé, vente payée) à une facture à normaliser. Tout vient de la base :
 * prix, quantités, groupes de taxation des produits, paiements — jamais de l'écran du caissier.
 *
 * Les prix ScanLinkPay sont TTC : une facture issue d'une vente est donc toujours en mode TTC. Un ticket en USD est
 * converti en CDF au taux de l'e-MCF (la facture DGI est en CDF, l'équivalent USD et le taux y figurent).
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { calculerTotaux, usdVersCdf } from './calcul';
import { GroupeTaxation, MoyenPaiement, TypeArticle } from './groupes';
import { ArticleFacture, ClientFacture, PaiementFacture } from './validation';
import type { DemandeEmission, ProfilFiscal } from './facture-normalisee.service';

export const groupeParDefaut = (p: Pick<ProfilFiscal, 'default_tax_group' | 'vat_regime'>): GroupeTaxation =>
  p.default_tax_group ?? (p.vat_regime === 'assujetti' ? 'B' : 'K');

/** Le groupe de chaque catégorie de produits d'une entreprise (ex. « Boissons » → B), réglé dans les paramètres fiscaux. */
export type GroupesCategories = Record<string, GroupeTaxation>;

export async function chargerGroupesCategories(db: SupabaseClient, organizationId: string): Promise<GroupesCategories> {
  const { data } = await db.from('fiscal_category_groups').select('category, tax_group').eq('organization_id', organizationId);
  return Object.fromEntries((data ?? []).map((r: any) => [r.category as string, r.tax_group as GroupeTaxation]));
}

/**
 * Le groupe de taxation d'un produit : le sien d'abord, puis celui de sa catégorie, puis le groupe par défaut de
 * l'entreprise. Un produit libre (sans fiche) prend le groupe par défaut.
 */
export function groupeDuProduit(
  p: Pick<ProduitFiscal, 'tax_group' | 'category'> | null,
  groupesCategories: GroupesCategories,
  profil: Pick<ProfilFiscal, 'default_tax_group' | 'vat_regime'>,
): GroupeTaxation {
  return p?.tax_group ?? (p?.category ? groupesCategories[p.category] : undefined) ?? groupeParDefaut(profil);
}

/** Moyens de paiement ScanLinkPay → types DGI (portefeuille et carte ScanLinkPay : question posée à la DGI). */
const MOYENS: Record<string, MoyenPaiement> = {
  cash: 'ESPECES',
  scanlinkpay: 'AUTRE',
  wallet: 'AUTRE',
  card: 'CARTEBANCAIRE',
  mobile_money: 'MOBILEMONEY',
};

interface ProduitFiscal {
  tax_group: GroupeTaxation | null;
  category?: string | null;
  dgi_item_type: TypeArticle | null;
  dgi_item_code: string | null;
  barcode: string | null;
  specific_tax_cents: number | null;
  unit_of_measure: string | null;
}

const COLONNES_PRODUIT = 'tax_group, category, dgi_item_type, dgi_item_code, barcode, specific_tax_cents, unit_of_measure';

interface LigneVente {
  nom: string;
  quantite: number;
  prixUnitaireCents: number;
  produit: ProduitFiscal | null;
}

/** Construit les articles et les paiements, en convertissant l'USD au taux donné. */
export function articlesEtPaiements(
  lignes: LigneVente[],
  paiementsVente: { methode: string; montantCents: number }[],
  devise: 'CDF' | 'USD',
  tauxUsd: string | null,
  profil: Pick<ProfilFiscal, 'default_tax_group' | 'vat_regime'>,
  groupesCategories: GroupesCategories = {},
): { articles: ArticleFacture[]; paiements: PaiementFacture[] } {
  if (devise === 'USD' && !tauxUsd) throw new BadRequestException("Taux du dollar indisponible : impossible de facturer un ticket en USD");
  const enCdf = (cents: number) => (devise === 'USD' ? usdVersCdf(cents, tauxUsd!) : cents);
  const articles: ArticleFacture[] = lignes.map((l) => {
    const p = l.produit;
    const ts = p?.specific_tax_cents ? enCdf(p.specific_tax_cents * l.quantite) : undefined;
    return {
      nom: l.nom,
      code: (p?.dgi_item_code || p?.barcode || undefined) ?? undefined,
      type: p?.dgi_item_type ?? 'BIE',
      groupe: groupeDuProduit(p, groupesCategories, profil),
      prixUnitaireCents: enCdf(l.prixUnitaireCents),
      quantite: String(l.quantite),
      taxeSpecifiqueCents: ts || undefined,
      taxeSpecifiqueUniteCents: ts && p?.specific_tax_cents ? enCdf(p.specific_tax_cents) : undefined,
      uniteMesure: p?.unit_of_measure ?? undefined,
    };
  });
  const total = calculerTotaux(articles, 'ttc').totalCents;
  const valides = paiementsVente.filter((p) => p.montantCents > 0);
  if (!valides.length) valides.push({ methode: 'cash', montantCents: 0 });
  // Le total des paiements doit être égal au total de la facture (1.1.19) : le dernier paiement absorbe l'arrondi
  // de conversion (quelques centimes de CDF au plus).
  const paiements: PaiementFacture[] = valides.map((p, i) => {
    const montant = i === valides.length - 1 ? 0 : enCdf(p.montantCents);
    return {
      moyen: MOYENS[p.methode] ?? 'AUTRE',
      montantCents: montant,
      ...(devise === 'USD' ? { devise: 'USD' as const, taux: tauxUsd! } : {}),
    };
  });
  const dejaCompte = paiements.slice(0, -1).reduce((s, p) => s + p.montantCents, 0);
  paiements[paiements.length - 1].montantCents = total - dejaCompte;
  if (paiements.some((p) => p.montantCents <= 0)) throw new BadRequestException('Paiements incohérents avec le total du ticket');
  return { articles, paiements };
}

async function nomOperateur(db: SupabaseClient, userId: string | null | undefined): Promise<string> {
  if (!userId) return 'Caisse';
  const { data } = await db.from('profiles').select('full_name').eq('id', userId).maybeSingle();
  return (data?.full_name as string)?.trim() || 'Caisse';
}

/** Un ticket de caisse PAYÉ → demande d'émission (FV). */
export async function depuisTicket(
  db: SupabaseClient,
  merchant: { id: string; organization_id: string },
  ticketId: string,
  client: ClientFacture,
  profil: ProfilFiscal,
  tauxUsd: () => Promise<string | null>,
  userId: string,
): Promise<DemandeEmission> {
  const { data: ticket } = await db
    .from('pos_tickets')
    .select('id, merchant_id, status, currency, total_cents, cashier_user_id')
    .eq('id', ticketId)
    .eq('merchant_id', merchant.id)
    .maybeSingle();
  if (!ticket) throw new NotFoundException('Ticket introuvable dans ce magasin');
  if (ticket.status !== 'paid') throw new BadRequestException("Le ticket n'est pas payé : la facture normalisée se fait après le paiement");
  const [{ data: lignes }, { data: paiements }] = await Promise.all([
    db
      .from('pos_ticket_items')
      .select(`product_name_snapshot, quantity, unit_price_cents_snapshot, status, stock_items(${COLONNES_PRODUIT})`)
      .eq('ticket_id', ticket.id)
      .eq('status', 'active'),
    db.from('pos_ticket_payments').select('method, amount_cents, status').eq('ticket_id', ticket.id).eq('status', 'confirmed'),
  ]);
  if (!lignes?.length) throw new BadRequestException('Ticket sans article');
  const devise = ticket.currency === 'USD' ? 'USD' : 'CDF';
  const taux = devise === 'USD' ? await tauxUsd() : null;
  const { articles, paiements: p } = articlesEtPaiements(
    lignes.map((l: any) => ({
      nom: l.product_name_snapshot,
      quantite: Number(l.quantity),
      prixUnitaireCents: Number(l.unit_price_cents_snapshot),
      produit: (Array.isArray(l.stock_items) ? l.stock_items[0] : l.stock_items) ?? null,
    })),
    (paiements ?? []).map((x: any) => ({ methode: x.method, montantCents: Number(x.amount_cents) })),
    devise,
    taux,
    profil,
    await chargerGroupesCategories(db, merchant.organization_id),
  );
  return {
    organizationId: merchant.organization_id,
    merchantId: merchant.id,
    source: { type: 'pos_ticket', id: ticket.id },
    facture: { type: 'FV', articles, client, paiements: p },
    mode: 'ttc',
    operateur: { id: ticket.cashier_user_id ?? userId, nom: await nomOperateur(db, ticket.cashier_user_id ?? userId) },
    userId,
    devise: taux ? { code: 'USD', taux } : undefined,
  };
}

/** Une vente PAYÉE (module Ventes) → demande d'émission (FV). */
export async function depuisVente(
  db: SupabaseClient,
  merchant: { id: string; organization_id: string },
  saleId: string,
  client: ClientFacture,
  profil: ProfilFiscal,
  tauxUsd: () => Promise<string | null>,
  userId: string,
): Promise<DemandeEmission> {
  const { data: vente } = await db
    .from('sales')
    .select('id, merchant_id, organization_id, status, currency, total_cents, payment_method, created_by')
    .eq('id', saleId)
    .eq('merchant_id', merchant.id)
    .maybeSingle();
  if (!vente) throw new NotFoundException('Vente introuvable dans ce magasin');
  if (vente.status !== 'PAID') throw new BadRequestException("La vente n'est pas payée : la facture normalisée se fait après le paiement");
  const { data: lignes } = await db
    .from('sale_items')
    .select(`name, quantity, unit_price_cents, stock_items(${COLONNES_PRODUIT})`)
    .eq('sale_id', vente.id);
  if (!lignes?.length) throw new BadRequestException('Vente sans article');
  const devise = vente.currency === 'USD' ? 'USD' : 'CDF';
  const taux = devise === 'USD' ? await tauxUsd() : null;
  const { articles, paiements } = articlesEtPaiements(
    lignes.map((l: any) => ({
      nom: l.name,
      quantite: Number(l.quantity),
      prixUnitaireCents: Number(l.unit_price_cents),
      produit: (Array.isArray(l.stock_items) ? l.stock_items[0] : l.stock_items) ?? null,
    })),
    [{ methode: vente.payment_method, montantCents: Number(vente.total_cents) }],
    devise,
    taux,
    profil,
    await chargerGroupesCategories(db, merchant.organization_id),
  );
  return {
    organizationId: merchant.organization_id,
    merchantId: merchant.id,
    source: { type: 'sale', id: vente.id },
    facture: { type: 'FV', articles, client, paiements },
    mode: 'ttc',
    operateur: { id: vente.created_by ?? userId, nom: await nomOperateur(db, vente.created_by ?? userId) },
    userId,
    devise: taux ? { code: 'USD', taux } : undefined,
  };
}
