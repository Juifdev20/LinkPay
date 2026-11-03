/**
 * Rapports X, Z et A de la facture normalisée — calcul pur, sans base de données (note de service 01/022).
 *
 * 1.3.3 — un rapport X ou Z contient au moins : montant total, montant taxable et taxe par TYPE de facture (g), et pour
 * chaque GROUPE de taxation de chaque type (h) ; le nombre de factures par type (i) ; les totaux par MODE DE PAIEMENT (j) ;
 * les réductions commerciales (k) ; les autres enregistrements qui ont réduit les ventes — les avoirs (l) ; le nombre
 * de ventes incomplètes (m). On y ajoute les dépôts et retraits d'espèces du tiroir (exigence 1.10).
 * 1.4.2 — un rapport A donne pour chaque article : code, nom, prix unitaire, taux, quantité vendue, quantité retournée,
 * quantité en stock.
 *
 * Seules les factures NORMALISÉES comptent dans les montants ; les autres sont les « ventes incomplètes ».
 */
import { quantiteEnMilliemes } from './calcul';
import { estAvoir, GroupeTaxation, LIBELLES_TYPES_FACTURE, TAUX_2026, TypeFacture } from './groupes';

export interface FacturePourRapport {
  invoice_type: TypeFacture;
  status: string;
  total_cents: number | null;
  vat_cents: number | null;
  reference_type?: string | null;
  computed_totals?: { groupes?: { groupe: GroupeTaxation; taux: number; totalCents: number; baseCents: number; tvaCents: number }[]; taxeSpecifiqueCents?: number } | null;
  payments?: { moyen: string; montantCents: number }[] | null;
  /** Lignes avec un prix d'origine (remises) — pour les réductions commerciales. */
  lignesRemisees?: { quantite: string | number; prixUnitaireCents: number; prixOrigineCents: number }[];
}

export interface MouvementEspeces {
  type: 'cash_in' | 'cash_out';
  amount_cents: number;
  currency: string;
}

export interface TotalGroupeRapport {
  groupe: GroupeTaxation;
  taux: number;
  totalCents: number;
  baseCents: number;
  tvaCents: number;
}

export interface TotalTypeRapport {
  type: TypeFacture;
  libelle: string;
  nombre: number;
  totalCents: number;
  baseCents: number;
  tvaCents: number;
  groupes: TotalGroupeRapport[];
}

export interface ContenuRapportXZ {
  parType: TotalTypeRapport[];
  ventes: { nombre: number; totalCents: number; tvaCents: number };
  avoirs: { nombre: number; totalCents: number; tvaCents: number };
  net: { totalCents: number; tvaCents: number };
  paiements: { moyen: string; totalCents: number }[];
  remboursements: { moyen: string; totalCents: number }[];
  reductions: { lignes: number; montantCents: number; remisesRrrCents: number };
  taxeSpecifiqueCents: number;
  incompletes: { nombre: number; provisoires: number; enEchec: number };
  especes: { devise: string; depotsCents: number; retraitsCents: number }[];
}

const ORDRE_TYPES: TypeFacture[] = ['FV', 'FT', 'EV', 'ET', 'FA', 'EA'];

export function contenuRapportXZ(factures: FacturePourRapport[], mouvements: MouvementEspeces[] = []): ContenuRapportXZ {
  const parType = new Map<TypeFacture, TotalTypeRapport & { _g: Map<GroupeTaxation, TotalGroupeRapport> }>();
  const paiements = new Map<string, number>();
  const remboursements = new Map<string, number>();
  let reductionLignes = 0;
  let reductionCents = 0;
  let rrr = 0;
  let ts = 0;
  let provisoires = 0;
  let enEchec = 0;

  for (const f of factures) {
    if (f.status !== 'confirmed') {
      if (f.status === 'failed') enEchec += 1;
      else if (f.status === 'provisional' || f.status === 'pending') provisoires += 1;
      continue;
    }
    const t = parType.get(f.invoice_type) ?? {
      type: f.invoice_type,
      libelle: LIBELLES_TYPES_FACTURE[f.invoice_type],
      nombre: 0,
      totalCents: 0,
      baseCents: 0,
      tvaCents: 0,
      groupes: [],
      _g: new Map(),
    };
    t.nombre += 1;
    t.totalCents += f.total_cents ?? 0;
    t.tvaCents += f.vat_cents ?? 0;
    for (const g of f.computed_totals?.groupes ?? []) {
      const cumul = t._g.get(g.groupe) ?? { groupe: g.groupe, taux: g.taux, totalCents: 0, baseCents: 0, tvaCents: 0 };
      cumul.totalCents += g.totalCents;
      cumul.baseCents += g.baseCents;
      cumul.tvaCents += g.tvaCents;
      t._g.set(g.groupe, cumul);
      t.baseCents += g.baseCents;
    }
    parType.set(f.invoice_type, t);
    const avoir = estAvoir(f.invoice_type);
    if (!avoir) ts += f.computed_totals?.taxeSpecifiqueCents ?? 0;
    if (avoir && f.reference_type === 'RRR') rrr += f.total_cents ?? 0;
    for (const p of f.payments ?? []) {
      const m = avoir ? remboursements : paiements;
      m.set(p.moyen, (m.get(p.moyen) ?? 0) + (p.montantCents ?? 0));
    }
    if (!avoir) {
      for (const l of f.lignesRemisees ?? []) {
        // (prix d'origine − prix remisé) × quantité, au centime le plus proche.
        const diff = BigInt(l.prixOrigineCents - l.prixUnitaireCents) * quantiteEnMilliemes(l.quantite);
        reductionCents += Number((2n * diff + 1000n) / 2000n);
        reductionLignes += 1;
      }
    }
  }

  const types = ORDRE_TYPES.filter((t) => parType.has(t)).map((t) => {
    const { _g, ...reste } = parType.get(t)!;
    return { ...reste, groupes: [..._g.values()].sort((a, b) => a.groupe.localeCompare(b.groupe)) };
  });
  const somme = (avoir: boolean) =>
    types
      .filter((t) => estAvoir(t.type) === avoir)
      .reduce((s, t) => ({ nombre: s.nombre + t.nombre, totalCents: s.totalCents + t.totalCents, tvaCents: s.tvaCents + t.tvaCents }), {
        nombre: 0,
        totalCents: 0,
        tvaCents: 0,
      });
  const ventes = somme(false);
  const avoirs = somme(true);

  const especes = new Map<string, { devise: string; depotsCents: number; retraitsCents: number }>();
  for (const m of mouvements) {
    const e = especes.get(m.currency) ?? { devise: m.currency, depotsCents: 0, retraitsCents: 0 };
    if (m.type === 'cash_in') e.depotsCents += m.amount_cents;
    else e.retraitsCents += m.amount_cents;
    especes.set(m.currency, e);
  }

  const liste = (m: Map<string, number>) => [...m.entries()].map(([moyen, totalCents]) => ({ moyen, totalCents })).sort((a, b) => b.totalCents - a.totalCents);
  return {
    parType: types,
    ventes,
    avoirs,
    net: { totalCents: ventes.totalCents - avoirs.totalCents, tvaCents: ventes.tvaCents - avoirs.tvaCents },
    paiements: liste(paiements),
    remboursements: liste(remboursements),
    reductions: { lignes: reductionLignes, montantCents: reductionCents, remisesRrrCents: rrr },
    taxeSpecifiqueCents: ts,
    incompletes: { nombre: provisoires + enEchec, provisoires, enEchec },
    especes: [...especes.values()],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Rapport A (articles)
// ---------------------------------------------------------------------------------------------------------------

export interface LignePourRapportA {
  invoice_type: TypeFacture;
  stock_item_id: string | null;
  code: string | null;
  name: string;
  tax_group: GroupeTaxation;
  unit_price_cents: number;
  quantity: string | number;
  line_total_cents: number;
}

export interface ArticleRapportA {
  code: string | null;
  nom: string;
  groupe: GroupeTaxation;
  taux: number;
  prixUnitaireCents: number;
  vendu: string;
  retourne: string;
  montantVenduCents: number;
  montantRetourneCents: number;
  enStock: number | null;
}

const enTexte = (m: bigint) => {
  const s = (Number(m) / 1000).toFixed(3);
  return s.replace(/\.?0+$/, '') || '0';
};

/** Lignes des factures NORMALISÉES de la période → un article par (produit ou code ou nom) et par prix. */
export function contenuRapportA(lignes: LignePourRapportA[], stock: Record<string, number> = {}): ArticleRapportA[] {
  const articles = new Map<string, { a: Omit<ArticleRapportA, 'vendu' | 'retourne'>; vendu: bigint; retourne: bigint; stockId: string | null }>();
  for (const l of lignes) {
    const cle = `${l.stock_item_id ?? l.code ?? l.name}|${l.unit_price_cents}|${l.tax_group}`;
    const e = articles.get(cle) ?? {
      a: {
        code: l.code,
        nom: l.name,
        groupe: l.tax_group,
        taux: TAUX_2026[l.tax_group],
        prixUnitaireCents: l.unit_price_cents,
        montantVenduCents: 0,
        montantRetourneCents: 0,
        enStock: null,
      },
      vendu: 0n,
      retourne: 0n,
      stockId: l.stock_item_id,
    };
    const q = quantiteEnMilliemes(l.quantity);
    if (estAvoir(l.invoice_type)) {
      e.retourne += q;
      e.a.montantRetourneCents += l.line_total_cents;
    } else {
      e.vendu += q;
      e.a.montantVenduCents += l.line_total_cents;
    }
    articles.set(cle, e);
  }
  return [...articles.values()]
    .map((e) => ({ ...e.a, vendu: enTexte(e.vendu), retourne: enTexte(e.retourne), enStock: e.stockId && stock[e.stockId] !== undefined ? stock[e.stockId] : null }))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}
