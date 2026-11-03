/**
 * Les référentiels de la facture normalisée (DGI, RDC) : groupes de taxation (mise à jour de février 2026, loi de
 * finances 2026), types de facture, de client, d'article, natures d'avoir, moyens de paiement.
 * Source : « FACNO – Groupes de taxation v1.2 », « Cas de test SFE v1.2 », API e-MCF v1.3 (docs/FACTURE_NORMALISEE.md).
 *
 * Les taux viennent aussi de l'e-MCF (`/api/info/taxGroups`) : ceux-ci sont la valeur par défaut et la référence des
 * tests ; s'ils changent, l'e-MCF fait foi.
 */

export const GROUPES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'] as const;
export type GroupeTaxation = (typeof GROUPES)[number];

/** Taux de TVA en pourcentage entier. N est à part : tout son montant est de la TVA (1.5.8). */
export const TAUX_2026: Record<GroupeTaxation, number> = {
  A: 0, // exonéré et hors champ
  B: 16, // taux normal
  C: 5, // taux réduit (était 8 %)
  D: 0, // régimes dérogatoires (TVA prise en charge par l'État)
  E: 0, // exportation
  F: 16, // marché public à financement extérieur
  G: 5, // marché public à financement extérieur (était 8 %)
  H: 0, // consignation d'emballage
  I: 0, // garantie et caution
  J: 0, // débours
  K: 0, // non-assujettis
  L: 0, // prélèvements sur ventes
  M: 0, // ventes réglementées : seul le HT est facturé
  N: 0, // TVA spécifique (traitée à part)
  O: 1, // nouveau taux réduit 2026
  P: 1, // marché public à financement extérieur (1 %)
};

export const LIBELLES_GROUPES: Record<GroupeTaxation, string> = {
  A: 'Exonéré et hors champ',
  B: 'Taxable 16 %',
  C: 'Taxable 5 %',
  D: 'Régimes dérogatoires TVA',
  E: 'Exportation et opérations assimilées',
  F: 'TVA marché public à financement extérieur (16 %)',
  G: 'TVA marché public à financement extérieur (5 %)',
  H: "Consignation / déconsignation d'emballage",
  I: 'Garantie et caution',
  J: 'Débours',
  K: 'Opérations réalisées par les non-assujettis',
  L: 'Prélèvements sur ventes',
  M: 'Ventes réglementées avec TVA spécifique',
  N: 'TVA spécifique',
  O: 'Taxable 1 %',
  P: 'TVA marché public à financement extérieur (1 %)',
};

/** Groupes que ScanLinkPay présente à l'homologation (décision du 03/11/2026) : seuls ceux-là seront autorisés. */
export const GROUPES_HOMOLOGUES: readonly GroupeTaxation[] = ['A', 'B', 'C', 'E', 'H', 'K', 'O'];

export const TYPES_FACTURE = ['FV', 'FT', 'FA', 'EV', 'ET', 'EA'] as const;
export type TypeFacture = (typeof TYPES_FACTURE)[number];
export const LIBELLES_TYPES_FACTURE: Record<TypeFacture, string> = {
  FV: 'Facture de vente',
  FT: "Facture d'acompte",
  FA: "Facture d'avoir",
  EV: "Facture de vente à l'exportation",
  ET: "Facture d'acompte à l'exportation",
  EA: "Facture d'avoir à l'exportation",
};
export const estAvoir = (t: TypeFacture) => t === 'FA' || t === 'EA';
export const estExport = (t: TypeFacture) => t === 'EV' || t === 'ET' || t === 'EA';
export const estAcompte = (t: TypeFacture) => t === 'FT' || t === 'ET';

export const TYPES_CLIENT = ['PP', 'PM', 'PC', 'PL', 'AO'] as const;
export type TypeClient = (typeof TYPES_CLIENT)[number];
export const LIBELLES_TYPES_CLIENT: Record<TypeClient, string> = {
  PP: 'Personne physique',
  PM: 'Personne morale',
  PC: 'Personne physique commerçante',
  PL: 'Profession libérale',
  AO: 'Ambassades et organisations internationales',
};

export const TYPES_ARTICLE = ['BIE', 'SER', 'TAX'] as const;
export type TypeArticle = (typeof TYPES_ARTICLE)[number];
/** TAX seulement pour les groupes L et N ; BIE / SER pour tous les autres. */
export const typeArticleAutorise = (type: TypeArticle, groupe: GroupeTaxation) =>
  type === 'TAX' ? groupe === 'L' || groupe === 'N' : groupe !== 'L' && groupe !== 'N';

export const NATURES_AVOIR = ['COR', 'RAN', 'RAM', 'RRR'] as const;
export type NatureAvoir = (typeof NATURES_AVOIR)[number];
export const LIBELLES_NATURES_AVOIR: Record<NatureAvoir, string> = {
  COR: 'Correction',
  RAN: 'Annulation',
  RAM: 'Avoir suite reprise',
  RRR: 'Remise, ristourne, rabais',
};

export const MOYENS_PAIEMENT = ['ESPECES', 'VIREMENT', 'CARTEBANCAIRE', 'MOBILEMONEY', 'CHEQUES', 'CREDIT', 'AUTRE'] as const;
export type MoyenPaiement = (typeof MOYENS_PAIEMENT)[number];

/** Code d'article obligatoire pour une opération hors champ (groupe A). */
export const CODE_HORS_CHAMP = 'HORS CHAMP';
