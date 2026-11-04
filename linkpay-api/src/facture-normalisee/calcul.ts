/**
 * Moteur de calcul de la facture normalisée — règles de la note de service n° 01/022 (section 1.5 « Calculs ») :
 *
 *   1.5.1  prix jusqu'à 2 décimales, quantités jusqu'à 3 décimales ;
 *   1.5.2  toute valeur décimale arrondie à la valeur la plus proche, 2 décimales au plus ;
 *   1.5.5  les calculs partent du prix unitaire ;
 *   1.5.6  mode TTC : le montant imposable de chaque groupe se calcule depuis le total du groupe ;
 *          mode HT  : le total de chaque groupe se calcule depuis le montant imposable du groupe ;
 *   1.5.7  montant imposable + taxe = total ; en cas d'arrondi, la TAXE est arrondie à la valeur SUPÉRIEURE ;
 *   1.5.8  le montant du groupe N est entièrement de la TVA ;
 *   1.5.10 la taxe spécifique augmente la base taxable de la TVA.
 *
 * Tout se fait en ENTIERS (centimes, millièmes de quantité, BigInt) : aucune erreur de virgule flottante.
 * Les montants calculés ici sont comparés à ceux de l'e-MCF AVANT de confirmer une facture : s'ils diffèrent, la
 * demande est annulée — une facture fausse n'est jamais émise (voir normalisation.service.ts).
 */
import { GroupeTaxation, GROUPES, TAUX_2026 } from './groupes';

export type ModePrix = 'ttc' | 'ht';

export interface LigneACalculer {
  /** Prix unitaire en centimes de CDF, dans le mode de la facture (TTC ou HT). */
  prixUnitaireCents: number;
  /** Quantité, 3 décimales au plus (« 2.375 », 3.5…). */
  quantite: string | number;
  groupe: GroupeTaxation;
  /** Taxe spécifique pour TOUTE la quantité, en centimes. */
  taxeSpecifiqueCents?: number;
}

export interface TotalGroupe {
  groupe: GroupeTaxation;
  /** Taux en pourcentage (N : 100, tout est TVA). */
  taux: number;
  totalCents: number;
  baseCents: number;
  tvaCents: number;
}

export interface TotauxFacture {
  groupes: TotalGroupe[];
  /** Montant de chaque ligne (prix × quantité, arrondi), dans l'ordre des lignes. */
  montantsLignes: number[];
  taxeSpecifiqueCents: number;
  totalCents: number;
  tvaCents: number;
}

/** Quantité en millièmes (entier). Refuse plus de 3 décimales, zéro et le négatif. */
export function quantiteEnMilliemes(q: string | number): bigint {
  const s = typeof q === 'number' ? q.toString() : q.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(s)) throw new Error(`Quantité invalide : ${q} (3 décimales au plus)`);
  const [ent, dec = ''] = s.split('.');
  const m = BigInt(ent) * 1000n + BigInt((dec + '000').slice(0, 3));
  if (m <= 0n) throw new Error('La quantité doit être supérieure à zéro');
  return m;
}

/** a / b arrondi à l'entier le plus proche (demi vers le haut), a ≥ 0, b > 0. */
const divArrondi = (a: bigint, b: bigint) => (2n * a + b) / (2n * b);
const divPlancher = (a: bigint, b: bigint) => a / b;
const divPlafond = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** Montant d'une ligne : prix unitaire × quantité, arrondi au centime le plus proche. */
export function montantLigne(prixUnitaireCents: number, quantite: string | number): number {
  if (!Number.isInteger(prixUnitaireCents) || prixUnitaireCents <= 0) {
    throw new Error('Le prix unitaire doit être un nombre entier de centimes supérieur à zéro');
  }
  return Number(divArrondi(BigInt(prixUnitaireCents) * quantiteEnMilliemes(quantite), 1000n));
}

/**
 * Totaux par groupe et de la facture.
 * @param taux taux à utiliser (ceux de l'e-MCF quand on les a lus ; sinon ceux de 2026).
 */
export function calculerTotaux(
  lignes: LigneACalculer[],
  mode: ModePrix,
  taux: Record<GroupeTaxation, number> = TAUX_2026,
): TotauxFacture {
  if (lignes.length === 0) throw new Error('Une facture contient au moins un article');
  const montantsLignes = lignes.map((l) => montantLigne(l.prixUnitaireCents, l.quantite));

  const parGroupe = new Map<GroupeTaxation, { montant: bigint; specifique: bigint }>();
  lignes.forEach((l, i) => {
    const ts = l.taxeSpecifiqueCents ?? 0;
    if (!Number.isInteger(ts) || ts < 0) throw new Error('Taxe spécifique invalide');
    const g = parGroupe.get(l.groupe) ?? { montant: 0n, specifique: 0n };
    g.montant += BigInt(montantsLignes[i]);
    g.specifique += BigInt(ts);
    parGroupe.set(l.groupe, g);
  });

  const groupes: TotalGroupe[] = [];
  for (const groupe of GROUPES) {
    const g = parGroupe.get(groupe);
    if (!g) continue;
    if (groupe === 'N') {
      // Tout le montant du groupe N est de la TVA, quel que soit le mode.
      const total = g.montant + g.specifique;
      groupes.push({ groupe, taux: 100, totalCents: Number(total), baseCents: 0, tvaCents: Number(total) });
      continue;
    }
    const t = BigInt(taux[groupe]);
    let base: bigint;
    let tva: bigint;
    if (mode === 'ttc') {
      // Les PRIX sont TTC ; la taxe spécifique s'ajoute à la base et supporte elle aussi la TVA (1.5.10) — lecture
      // CONFIRMÉE par l'e-MCF de test de la DGI (cas n° 8 : B 3 × 11 600 + 3 × 500 → total 36 540, base 31 500, TVA 5 040).
      // base des prix = prix / (1 + t), arrondie vers le BAS pour que la taxe soit arrondie vers le HAUT (1.5.7).
      const baseLignes = divPlancher(g.montant * 100n, 100n + t);
      base = baseLignes + g.specifique;
      tva = g.montant - baseLignes + divPlafond(g.specifique * t, 100n);
    } else {
      base = g.montant + g.specifique;
      tva = divPlafond(base * t, 100n);
    }
    groupes.push({ groupe, taux: Number(t), totalCents: Number(base + tva), baseCents: Number(base), tvaCents: Number(tva) });
  }

  const totalCents = groupes.reduce((s, g) => s + g.totalCents, 0);
  const tvaCents = groupes.reduce((s, g) => s + g.tvaCents, 0);
  const taxeSpecifiqueCents = lignes.reduce((s, l) => s + (l.taxeSpecifiqueCents ?? 0), 0);
  if (totalCents <= 0) throw new Error('Le montant de la facture doit être supérieur à zéro');
  return { groupes, montantsLignes, taxeSpecifiqueCents, totalCents, tvaCents };
}

// ---------------------------------------------------------------------------------------------------------------
// Devises (1.1.30) : la facture est en CDF ; un prix en USD est converti au taux du jour, et l'équivalent en USD
// figure sur la facture. Le taux doit être à 1 % près du taux moyen de la Banque Centrale du Congo.
// ---------------------------------------------------------------------------------------------------------------

/** Taux « 2850.5 » → dix-millièmes entiers (4 décimales au plus). */
function tauxEnDixMilliemes(taux: string | number): bigint {
  const s = typeof taux === 'number' ? taux.toString() : taux.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,4})?$/.test(s)) throw new Error(`Taux de change invalide : ${taux}`);
  const [ent, dec = ''] = s.split('.');
  const v = BigInt(ent) * 10000n + BigInt((dec + '0000').slice(0, 4));
  if (v <= 0n) throw new Error('Le taux de change doit être supérieur à zéro');
  return v;
}

/** Centimes de USD → centimes de CDF au taux donné (CDF pour 1 USD), arrondi au centime le plus proche. */
export function usdVersCdf(usdCents: number, taux: string | number): number {
  if (!Number.isInteger(usdCents) || usdCents < 0) throw new Error('Montant USD invalide');
  return Number(divArrondi(BigInt(usdCents) * tauxEnDixMilliemes(taux), 10000n));
}

/** Centimes de CDF → centimes de USD (équivalent indicatif sur la facture). */
export function cdfVersUsd(cdfCents: number, taux: string | number): number {
  if (!Number.isInteger(cdfCents) || cdfCents < 0) throw new Error('Montant CDF invalide');
  return Number(divArrondi(BigInt(cdfCents) * 10000n, tauxEnDixMilliemes(taux)));
}

/** Le taux utilisé est-il à 1 % près (ou moins) du taux de référence de la Banque Centrale ? */
export function tauxDansLaMarge(taux: string | number, tauxReference: string | number, margePourcent = 1): boolean {
  const a = tauxEnDixMilliemes(taux);
  const r = tauxEnDixMilliemes(tauxReference);
  const ecart = a > r ? a - r : r - a;
  return ecart * 100n <= r * BigInt(margePourcent);
}

/** Numéro de facture du SFE : série par année de gestion, ex. 2026/000123. */
export const numeroFacture = (annee: number, sequence: number) => `${annee}/${String(sequence).padStart(6, '0')}`;
