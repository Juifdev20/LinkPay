/**
 * Les règles de la DGI vérifiées AVANT d'envoyer une facture à l'e-MCF (note de service 01/022 et cas de test).
 * Chaque erreur est un message en français, affichable tel quel au caissier.
 */
import { calculerTotaux, LigneACalculer, ModePrix, quantiteEnMilliemes, TotauxFacture } from './calcul';
import {
  CODE_HORS_CHAMP,
  estAvoir,
  estExport,
  GroupeTaxation,
  GROUPES,
  LIBELLES_TYPES_CLIENT,
  MoyenPaiement,
  MOYENS_PAIEMENT,
  NatureAvoir,
  NATURES_AVOIR,
  TypeArticle,
  typeArticleAutorise,
  TypeClient,
  TYPES_ARTICLE,
  TYPES_CLIENT,
  TYPES_FACTURE,
  TypeFacture,
} from './groupes';

export interface ArticleFacture extends LigneACalculer {
  code?: string;
  type: TypeArticle;
  nom: string;
  uniteMesure?: string;
  /** Prix avant remise (en centimes) et motif — « Remise 10 % »… */
  prixOrigineCents?: number;
  modificationPrix?: string;
  /** Avoir : la ligne de la facture d'origine remboursée. */
  ligneOrigineId?: string;
}

export interface ClientFacture {
  type: TypeClient;
  nif?: string;
  nom?: string;
  contact?: string;
  adresse?: string;
  /** Client AO : référence du certificat d'exonération (commentaire A « Réf. Exo. : »). */
  referenceExoneration?: string;
}

export interface PaiementFacture {
  moyen: MoyenPaiement;
  /** Montant en centimes de CDF (la facture est en CDF). */
  montantCents: number;
  /** Paiement en USD : devise et taux (CDF pour 1 USD). */
  devise?: 'USD';
  taux?: string;
}

export interface FactureAEmettre {
  type: TypeFacture;
  mode: ModePrix;
  articles: ArticleFacture[];
  client: ClientFacture;
  paiements: PaiementFacture[];
  groupesAutorises: readonly GroupeTaxation[];
  /** Commentaires B à H (A est réservé à la référence d'exonération). */
  commentaires?: string[];
  avoir?: { nature: NatureAvoir; referenceCode?: string };
  /** Groupe D : référence du document de dérogation délivré par la DGI (commentaire A). */
  referenceDerogation?: string;
}

export const NIF_VALIDE = /^[A-Z0-9]{9}$/;
const MAX_COMMENTAIRES = 8;

export type ResultatValidation = { ok: true; totaux: TotauxFacture } | { ok: false; erreurs: string[] };

export function validerFacture(f: FactureAEmettre): ResultatValidation {
  const erreurs: string[] = [];

  if (!TYPES_FACTURE.includes(f.type)) erreurs.push(`Type de facture inconnu : ${f.type}`);
  if (f.mode !== 'ttc' && f.mode !== 'ht') erreurs.push('Le mode de prix doit être TTC ou HT');
  if (!f.articles?.length) erreurs.push('La facture doit contenir au moins un article');

  // --- Articles
  (f.articles ?? []).forEach((a, i) => {
    const n = `Article ${i + 1} (${a.nom || 'sans nom'})`;
    if (!a.nom?.trim()) erreurs.push(`Article ${i + 1} : le nom est obligatoire`);
    if (!GROUPES.includes(a.groupe)) {
      erreurs.push(`${n} : groupe de taxation inconnu`);
      return;
    }
    if (!f.groupesAutorises.includes(a.groupe)) {
      erreurs.push(`${n} : le groupe ${a.groupe} n'est pas autorisé pour cette entreprise`);
    }
    if (!TYPES_ARTICLE.includes(a.type)) erreurs.push(`${n} : type d'article inconnu`);
    else if (!typeArticleAutorise(a.type, a.groupe)) {
      erreurs.push(`${n} : le type ${a.type} n'est pas permis pour le groupe ${a.groupe} (TAX seulement pour L et N)`);
    }
    if (a.code?.trim().toUpperCase() === CODE_HORS_CHAMP && a.groupe !== 'A') {
      erreurs.push(`${n} : le code « HORS CHAMP » n'est permis que dans le groupe A`);
    }
    if (a.groupe === 'E' && !estExport(f.type)) {
      erreurs.push(`${n} : le groupe E (exportation) est réservé aux factures d'exportation`);
    }
    if (!Number.isInteger(a.prixUnitaireCents) || a.prixUnitaireCents <= 0) {
      erreurs.push(`${n} : le prix doit être supérieur à zéro (2 décimales au plus)`);
    }
    try {
      quantiteEnMilliemes(a.quantite);
    } catch {
      erreurs.push(`${n} : quantité invalide (supérieure à zéro, 3 décimales au plus)`);
    }
    if (a.prixOrigineCents !== undefined) {
      if (!Number.isInteger(a.prixOrigineCents) || a.prixOrigineCents <= a.prixUnitaireCents) {
        erreurs.push(`${n} : le prix d'origine doit être supérieur au prix remisé`);
      }
      if (!a.modificationPrix?.trim()) erreurs.push(`${n} : indiquez le motif de la modification du prix (ex. « Remise 10 % »)`);
    }
  });

  // --- Client (types et champs obligatoires des « Cas de test »)
  const c = f.client;
  if (!c || !TYPES_CLIENT.includes(c.type)) erreurs.push('Le type de client est obligatoire (PP, PM, PC, PL ou AO)');
  else {
    const libelle = LIBELLES_TYPES_CLIENT[c.type];
    if (c.type !== 'PP' && !c.nom?.trim()) erreurs.push(`Client « ${libelle} » : le nom est obligatoire`);
    if ((c.type === 'PM' || c.type === 'PC' || c.type === 'PL') && !c.nif?.trim()) {
      erreurs.push(`Client « ${libelle} » : le NIF est obligatoire`);
    }
    if (c.nif && !NIF_VALIDE.test(c.nif.trim().toUpperCase())) erreurs.push('Le NIF du client doit avoir 9 caractères (lettres et chiffres)');
    if (c.type === 'AO' && !c.referenceExoneration?.trim()) {
      erreurs.push("Client « Ambassades et organisations internationales » : la référence du certificat d'exonération est obligatoire");
    }
  }
  if ((f.articles ?? []).some((a) => a.groupe === 'D') && !f.referenceDerogation?.trim() && !c?.referenceExoneration?.trim()) {
    erreurs.push('Groupe D : la référence du document de dérogation de la DGI est obligatoire');
  }

  // --- Commentaires (8 lignes au plus, la ligne A étant réservée)
  const nbCommentaires = (f.commentaires?.length ?? 0) + (c?.referenceExoneration || f.referenceDerogation ? 1 : 0);
  if (nbCommentaires > MAX_COMMENTAIRES) erreurs.push(`${MAX_COMMENTAIRES} lignes de commentaire au plus`);

  // --- Avoir
  if (estAvoir(f.type)) {
    if (!f.avoir || !NATURES_AVOIR.includes(f.avoir.nature)) {
      erreurs.push("La nature de l'avoir est obligatoire : correction, annulation, reprise ou remise (COR, RAN, RAM, RRR)");
    } else if (f.avoir.nature !== 'RRR' && !f.avoir.referenceCode?.trim()) {
      erreurs.push("L'avoir doit indiquer le code DEF/DGI de la facture de vente d'origine");
    }
  } else if (f.avoir) {
    erreurs.push("Une nature d'avoir n'est permise que sur une facture d'avoir");
  }

  if (erreurs.length) return { ok: false, erreurs };

  // --- Totaux, puis paiements : leur somme doit être égale au total (1.1.19)
  let totaux: TotauxFacture;
  try {
    totaux = calculerTotaux(f.articles, f.mode);
  } catch (e) {
    return { ok: false, erreurs: [(e as Error).message] };
  }
  const paiements = f.paiements?.length ? f.paiements : [{ moyen: 'ESPECES' as const, montantCents: totaux.totalCents }];
  paiements.forEach((p, i) => {
    if (!MOYENS_PAIEMENT.includes(p.moyen)) erreurs.push(`Paiement ${i + 1} : moyen de paiement inconnu`);
    if (!Number.isInteger(p.montantCents) || p.montantCents <= 0) erreurs.push(`Paiement ${i + 1} : montant invalide`);
    if (p.devise === 'USD' && !p.taux) erreurs.push(`Paiement ${i + 1} : le taux de change est obligatoire pour un paiement en USD`);
  });
  const somme = paiements.reduce((s, p) => s + (p.montantCents || 0), 0);
  if (somme !== totaux.totalCents) {
    erreurs.push(`Le total des paiements (${(somme / 100).toFixed(2)} CDF) doit être égal au total de la facture (${(totaux.totalCents / 100).toFixed(2)} CDF)`);
  }
  return erreurs.length ? { ok: false, erreurs } : { ok: true, totaux };
}

// ---------------------------------------------------------------------------------------------------------------
// Avoirs (1.1.26) : les articles remboursés existent sur la facture d'origine, au MÊME prix unitaire, et les
// quantités remboursées (tous avoirs confondus) ne dépassent pas les quantités vendues.
// ---------------------------------------------------------------------------------------------------------------

export interface LigneOrigine {
  id: string;
  prixUnitaireCents: number;
  quantite: string | number;
  groupe: GroupeTaxation;
}

/**
 * @param dejaRembourse quantités déjà remboursées par les avoirs CONFIRMÉS précédents, par id de ligne d'origine.
 */
export function verifierAvoir(
  origine: LigneOrigine[],
  dejaRembourse: Record<string, string | number>,
  lignes: ArticleFacture[],
): string[] {
  const erreurs: string[] = [];
  const parId = new Map(origine.map((l) => [l.id, l]));
  const demande = new Map<string, bigint>();
  lignes.forEach((l, i) => {
    const n = `Article ${i + 1} (${l.nom})`;
    const o = l.ligneOrigineId ? parId.get(l.ligneOrigineId) : undefined;
    if (!o) {
      erreurs.push(`${n} : cet article n'existe pas sur la facture d'origine`);
      return;
    }
    if (l.prixUnitaireCents !== o.prixUnitaireCents) erreurs.push(`${n} : le prix doit être celui de la facture d'origine`);
    if (l.groupe !== o.groupe) erreurs.push(`${n} : le groupe de taxation doit être celui de la facture d'origine`);
    try {
      demande.set(o.id, (demande.get(o.id) ?? 0n) + quantiteEnMilliemes(l.quantite));
    } catch {
      erreurs.push(`${n} : quantité invalide`);
    }
  });
  for (const [id, q] of demande) {
    const o = parId.get(id)!;
    const vendu = quantiteEnMilliemes(o.quantite);
    const deja = dejaRembourse[id] !== undefined && Number(dejaRembourse[id]) > 0 ? quantiteEnMilliemes(dejaRembourse[id]) : 0n;
    if (deja + q > vendu) {
      const reste = Number(vendu - deja) / 1000;
      erreurs.push(`Quantité à rembourser trop grande : il reste ${reste} à rembourser sur cet article`);
    }
  }
  return erreurs;
}
