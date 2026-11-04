/**
 * De notre facture à la demande e-MCF (InvoiceRequestDataDto, API v1.3), et comparaison des montants que l'e-MCF
 * renvoie avec les nôtres : la facture n'est confirmée que s'ils sont IDENTIQUES (flux de la DGI, étape
 * « vérifier les totaux retournés par l'API avec son propre calcul »).
 */
import { quantiteEnMilliemes, TotauxFacture } from './calcul';
import { estAvoir, GroupeTaxation, GROUPES, LIBELLES_NATURES_AVOIR, LIBELLES_TYPES_CLIENT } from './groupes';
import { ReponseDemandeFacture } from './emcf.client';
import { FactureAEmettre } from './validation';

/** Centimes → montant décimal de l'API (2 décimales). */
const decimal = (cents: number) => Math.round(cents) / 100;
/** Taxe spécifique par unité (centimes, arrondie) déduite du total et de la quantité, quand l'unité n'est pas connue. */
export const valeurParUnite = (totalCents: number, quantite: string | number): number => {
  const q = quantiteEnMilliemes(quantite);
  return Number((2n * BigInt(totalCents) * 1000n + q) / (2n * q));
};
/** Montant décimal de l'API → centimes. */
export const enCentimes = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v ?? 0);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
};

export interface ContexteRequete {
  nif: string;
  rn: string;
  isf: string;
  operateur: { id?: string; nom: string };
  /** Équivalent en devise affiché sur la facture (1.1.30). */
  devise?: { code: 'USD'; taux: string; date: Date };
}

export function construireRequete(f: FactureAEmettre, ctx: ContexteRequete): Record<string, unknown> {
  const commentaires: Record<string, string> = {};
  const refA = f.client.referenceExoneration?.trim() || f.referenceDerogation?.trim();
  if (refA) commentaires.cmta = `Réf. Exo. : ${refA}`;
  (f.commentaires ?? []).slice(0, 7).forEach((texte, i) => {
    commentaires[`cmt${'bcdefgh'[i]}`] = texte.slice(0, 120);
  });

  const requete: Record<string, unknown> = {
    nif: ctx.nif,
    rn: ctx.rn,
    mode: f.mode,
    isf: ctx.isf,
    type: f.type,
    items: f.articles.map((a) => {
      const item: Record<string, unknown> = {
        type: a.type,
        name: a.nom.trim().slice(0, 200),
        price: decimal(a.prixUnitaireCents),
        quantity: Number(quantiteEnMilliemes(a.quantite)) / 1000,
        taxGroup: a.groupe,
      };
      if (a.code?.trim()) item.code = a.code.trim().slice(0, 50);
      if (a.taxeSpecifiqueCents) {
        // L'e-MCF veut les DEUX : le montant pour toute la quantité et la valeur par unité (erreur 22 sinon).
        item.taxSpecificAmount = decimal(a.taxeSpecifiqueCents);
        item.taxSpecificValue = String(decimal(a.taxeSpecifiqueUniteCents ?? valeurParUnite(a.taxeSpecifiqueCents, a.quantite)));
      }
      if (a.prixOrigineCents !== undefined) {
        item.originalPrice = decimal(a.prixOrigineCents);
        item.priceModification = (a.modificationPrix ?? '').trim().slice(0, 60);
      }
      return item;
    }),
    client: nettoyer({
      nif: f.client.nif?.trim().toUpperCase(),
      name: f.client.nom?.trim(),
      contact: f.client.contact?.trim(),
      address: f.client.adresse?.trim(),
      type: f.client.type,
      typeDesc: LIBELLES_TYPES_CLIENT[f.client.type],
    }),
    // Le NOM seulement : l'identifiant interne (un long UUID) s'afficherait tel quel sur la facture du site de la DGI,
    // et n'est pas sur notre facture — les deux doivent porter les mêmes données.
    operator: { name: ctx.operateur.nom.trim().slice(0, 100) || 'Caisse' },
    ...commentaires,
  };

  if (f.paiements?.length) {
    requete.payment = f.paiements.map((p) =>
      nettoyer({ name: p.moyen, amount: decimal(p.montantCents), currencyCode: p.devise, currencyRate: p.taux ? Number(p.taux) : undefined }),
    );
  }

  if (estAvoir(f.type) && f.avoir) {
    requete.reference = f.avoir.nature === 'RRR' ? 'RRR' : f.avoir.referenceCode?.trim();
    requete.referenceType = f.avoir.nature;
    requete.referenceDesc = LIBELLES_NATURES_AVOIR[f.avoir.nature].slice(0, 20);
  }

  if (ctx.devise) {
    requete.curCode = ctx.devise.code;
    requete.curDate = formaterDate(ctx.devise.date);
    requete.curRate = Number(ctx.devise.taux);
  }
  return requete;
}

const nettoyer = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

/** « 2024-02-01 12:44:55 » (format de l'exemple de l'API), heure de Kinshasa (UTC+1). */
export function formaterDate(d: Date): string {
  const k = new Date(d.getTime() + 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}:${p(k.getUTCSeconds())}`;
}

export interface EcartMontant {
  champ: string;
  nous: number;
  dgi: number;
}

/**
 * Compare nos totaux à la réponse de l'e-MCF, groupe par groupe (taa/haa/vaa…), plus total et vtotal.
 * Une liste vide = montants identiques : on peut confirmer.
 */
export function comparerMontants(nous: TotauxFacture, dgi: ReponseDemandeFacture): EcartMontant[] {
  const ecarts: EcartMontant[] = [];
  const parGroupe = new Map(nous.groupes.map((g) => [g.groupe, g]));
  for (const groupe of GROUPES as readonly GroupeTaxation[]) {
    const x = groupe.toLowerCase();
    const g = parGroupe.get(groupe);
    const champs: [string, number][] = [
      [`ta${x}`, g?.totalCents ?? 0],
      [`ha${x}`, g?.baseCents ?? 0],
      [`va${x}`, g?.tvaCents ?? 0],
    ];
    for (const [champ, attendu] of champs) {
      // Un groupe absent de la réponse vaut zéro ; un groupe présent chez nous doit y être.
      if (dgi[champ] === undefined || dgi[champ] === null) {
        if (attendu !== 0) ecarts.push({ champ, nous: attendu, dgi: 0 });
        continue;
      }
      const recu = enCentimes(dgi[champ]);
      if (recu !== attendu) ecarts.push({ champ, nous: attendu, dgi: recu });
    }
  }
  for (const [champ, attendu] of [
    ['total', nous.totalCents],
    ['vtotal', nous.tvaCents],
  ] as [string, number][]) {
    const recu = enCentimes(dgi[champ]);
    if (recu !== attendu) ecarts.push({ champ, nous: attendu, dgi: recu });
  }
  return ecarts;
}

/** Ce que l'on renvoie à la confirmation : les montants de l'e-MCF, identiques aux nôtres. */
export const montantsDeConfirmation = (dgi: ReponseDemandeFacture) => ({ total: Number(dgi.total), vtotal: Number(dgi.vtotal) });
