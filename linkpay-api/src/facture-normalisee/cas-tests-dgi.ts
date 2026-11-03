/**
 * Les cas de test de l'homologation (document « Cas de test SFE » v1.2 de la DGI) : 29 factures, à faire en mode TTC
 * et en mode HT, puis les rapports X, Z et A (R01 à R03). Ce fichier les décrit ; tests-dgi.service.ts les rejoue sur
 * l'e-MCF de TEST.
 *
 * « Il n'est pas obligatoire pour un SFE de soutenir tous les groupes de taxation : il ne peut être utilisé que pour
 * les groupes qui ont fait partie de la validation » (guide d'homologation v1.2). Un cas qui demande un groupe que
 * l'entreprise n'a pas déclaré (D, F, G, I, J, L, M, N, P pour ScanLinkPay) est donc marqué « hors périmètre ».
 */
import { GroupeTaxation, NatureAvoir, TypeFacture } from './groupes';
import { ClientFacture, PaiementFacture } from './validation';

export type ClientTest = 'PP' | 'PM' | 'PC' | 'PL' | 'AO';

export interface ArticleTest {
  groupe: GroupeTaxation;
  quantite: string;
  type?: 'BIE' | 'SER' | 'TAX';
  /** Prix unitaire imposé (sinon le prix de référence du groupe), en centimes de CDF. */
  prixCents?: number;
  /** Taxe spécifique PAR UNITÉ, en centimes. */
  taxeSpecifiqueParUniteCents?: number;
  /** Remise : prix d'origine et motif imprimé. */
  remise?: { prixOrigineCents: number; motif: string };
  code?: string;
  nom?: string;
}

export interface CasTestDgi {
  num: number;
  titre: string;
  type: TypeFacture;
  client: ClientTest;
  articles: ArticleTest[];
  /** Avoir : sa nature et la facture de vente du cas d'origine (lignes : n° de ligne → quantité ; vide = tout). */
  avoir?: { nature: NatureAvoir; origine?: number; lignes?: { ligne: number; quantite: string }[] };
  moyen?: PaiementFacture['moyen'];
  /** Équivalent du total en USD sur la facture (cas 26). */
  equivalentUsd?: boolean;
  /** Ce que la DGI demande de vérifier sur la photo. */
  aVerifier: string;
}

/** Prix de référence par groupe (en centimes de CDF), le même en TTC et en HT : seul le mode change. */
export const PRIX_REFERENCE: Partial<Record<GroupeTaxation, number>> = {
  A: 250000, // 2 500 CDF
  B: 1160000, // 11 600 CDF
  C: 525000, // 5 250 CDF
  D: 800000,
  E: 2500000,
  F: 1160000,
  G: 525000,
  H: 150000, // casier consigné
  I: 1000000,
  J: 300000,
  K: 300000,
  L: 50000,
  M: 1000000,
  N: 160000,
  O: 1010000,
  P: 1010000,
};

const NOMS: Partial<Record<GroupeTaxation, string>> = {
  A: 'Article exonéré (test)',
  B: 'Article taxable 16 % (test)',
  C: 'Article taxable 5 % (test)',
  D: 'Article régime dérogatoire (test)',
  E: 'Article exporté (test)',
  F: 'Article marché public 16 % (test)',
  G: 'Article marché public 5 % (test)',
  H: 'Casier consigné (test)',
  I: 'Caution (test)',
  J: 'Débours (test)',
  K: 'Article non assujetti (test)',
  L: 'Prélèvement sur vente (test)',
  M: 'Vente réglementée (test)',
  N: 'TVA spécifique (test)',
  O: 'Article taxable 1 % (test)',
  P: 'Article marché public 1 % (test)',
};

const a = (groupe: GroupeTaxation, quantite: string, autre: Partial<ArticleTest> = {}): ArticleTest => ({ groupe, quantite, ...autre });

export const CAS_TESTS_DGI: CasTestDgi[] = [
  { num: 1, titre: 'Vente : 1 × B, 1 × C', type: 'FV', client: 'PM', articles: [a('B', '1'), a('C', '1')], aVerifier: 'Deux groupes, totaux et TVA par groupe' },
  { num: 2, titre: 'Vente : 1 × A', type: 'FV', client: 'PM', articles: [a('A', '1')], aVerifier: 'Groupe A sans TVA' },
  { num: 3, titre: 'Vente : 2 × B, 3 × A', type: 'FV', client: 'PM', articles: [a('B', '2'), a('A', '3')], moyen: 'MOBILEMONEY', aVerifier: 'Quantités entières, deux groupes' },
  { num: 4, titre: 'Vente : 2,375 × B, 3,5 × A', type: 'FV', client: 'PM', articles: [a('B', '2.375'), a('A', '3.5')], aVerifier: 'Quantités à 3 décimales et arrondis' },
  { num: 5, titre: 'Vente : client personne physique', type: 'FV', client: 'PP', articles: [a('B', '2'), a('A', '3')], aVerifier: 'Mention [PP] Personne physique' },
  { num: 6, titre: 'Vente : client commerçant', type: 'FV', client: 'PC', articles: [a('B', '2'), a('A', '3')], aVerifier: 'Mention [PC], nom et NIF du client' },
  { num: 7, titre: 'Vente : client profession libérale', type: 'FV', client: 'PL', articles: [a('B', '2'), a('A', '3')], moyen: 'VIREMENT', aVerifier: 'Mention [PL], nom et NIF du client' },
  {
    num: 8,
    titre: 'Vente avec taxe spécifique',
    type: 'FV',
    client: 'PM',
    articles: [a('B', '3', { taxeSpecifiqueParUniteCents: 50000 }), a('C', '2', { taxeSpecifiqueParUniteCents: 20000 }), a('A', '1')],
    aVerifier: 'Taxe spécifique par article et dans les totaux',
  },
  { num: 9, titre: 'Facture d’acompte', type: 'FT', client: 'PM', articles: [a('B', '2'), a('A', '3')], moyen: 'VIREMENT', aVerifier: 'Mention FACTURE D’ACOMPTE' },
  {
    num: 10,
    titre: 'Avoir — annulation (du cas 1)',
    type: 'FA',
    client: 'PM',
    articles: [a('B', '1'), a('C', '1')],
    avoir: { nature: 'RAN', origine: 1 },
    aVerifier: 'Mention FACTURE D’AVOIR, nature Annulation, référence de la facture d’origine',
  },
  {
    num: 11,
    titre: 'Avoir — reprise (du cas 3)',
    type: 'FA',
    client: 'PM',
    articles: [a('B', '1'), a('A', '1')],
    avoir: { nature: 'RAM', origine: 3, lignes: [{ ligne: 1, quantite: '1' }, { ligne: 2, quantite: '1' }] },
    aVerifier: 'Nature « Avoir suite reprise », référence de la facture d’origine',
  },
  {
    num: 12,
    titre: 'Avoir — correction (du cas 6)',
    type: 'FA',
    client: 'PC',
    articles: [a('B', '1')],
    avoir: { nature: 'COR', origine: 6, lignes: [{ ligne: 1, quantite: '1' }] },
    aVerifier: 'Nature Correction, référence de la facture d’origine',
  },
  {
    num: 13,
    titre: 'Avoir — remise, rabais, ristourne (RRR)',
    type: 'FA',
    client: 'PM',
    articles: [a('B', '3'), a('C', '2'), a('A', '1')],
    avoir: { nature: 'RRR' },
    aVerifier: 'Référence à la facture d’origine égale à « RRR »',
  },
  { num: 14, titre: 'Vente : 2 × D, client ambassade', type: 'FV', client: 'AO', articles: [a('D', '2')], aVerifier: 'Référence du certificat d’exonération' },
  { num: 15, titre: 'Vente à l’exportation : 3 × E', type: 'EV', client: 'PM', articles: [a('E', '3')], moyen: 'VIREMENT', aVerifier: 'Mention EXPORTATION, groupe E à 0 %' },
  {
    num: 16,
    titre: 'Avoir à l’exportation — annulation (du cas 15)',
    type: 'EA',
    client: 'PM',
    articles: [a('E', '3')],
    avoir: { nature: 'RAN', origine: 15 },
    aVerifier: 'Mention FACTURE D’AVOIR À L’EXPORTATION, référence d’origine',
  },
  { num: 17, titre: 'Acompte à l’exportation : 3 × E', type: 'ET', client: 'PM', articles: [a('E', '3')], moyen: 'VIREMENT', aVerifier: 'Mention ACOMPTE À L’EXPORTATION' },
  { num: 18, titre: 'Vente : 2 × F, 2 × G', type: 'FV', client: 'PM', articles: [a('F', '2'), a('G', '2')], aVerifier: 'Groupes marché public' },
  { num: 19, titre: 'Vente : 2 × B, 2 × H (consignation)', type: 'FV', client: 'PM', articles: [a('B', '2'), a('H', '2')], aVerifier: 'Consignation sans TVA' },
  { num: 20, titre: 'Vente : 1 × C, 1 × I', type: 'FV', client: 'PM', articles: [a('C', '1'), a('I', '1', { type: 'SER' })], aVerifier: 'Garantie sans TVA' },
  { num: 21, titre: 'Vente : 2 × J (débours)', type: 'FV', client: 'PM', articles: [a('J', '2', { type: 'SER' })], aVerifier: 'Débours sans TVA' },
  { num: 22, titre: 'Vente : 2 × K (non assujetti)', type: 'FV', client: 'PM', articles: [a('K', '2')], aVerifier: 'Groupe K sans TVA' },
  { num: 23, titre: 'Vente : 2 × B, 2 × L', type: 'FV', client: 'PM', articles: [a('B', '2'), a('L', '2', { type: 'TAX' })], aVerifier: 'Prélèvement sur vente [TAX]' },
  { num: 24, titre: 'Vente : 3 × M, 3 × N', type: 'FV', client: 'PM', articles: [a('M', '3'), a('N', '3', { type: 'TAX' })], aVerifier: 'TVA spécifique' },
  {
    num: 25,
    titre: 'Vente avec remises',
    type: 'FV',
    client: 'PM',
    articles: [
      a('B', '2', { prixCents: 1044000, remise: { prixOrigineCents: 1160000, motif: 'Remise 10 %' } }),
      a('C', '3'),
      // Remise totale de 300 CDF sur les 3 articles = 100 CDF par article.
      a('A', '3', { prixCents: 240000, remise: { prixOrigineCents: 250000, motif: 'Remise 300 CDF' } }),
    ],
    aVerifier: 'Prix d’origine et motif de la remise sur chaque ligne',
  },
  { num: 26, titre: 'Vente avec équivalent en USD', type: 'FV', client: 'PM', articles: [a('B', '2'), a('C', '3')], equivalentUsd: true, aVerifier: 'Total équivalent en USD et taux' },
  { num: 27, titre: 'Vente : 1 × O (1 %)', type: 'FV', client: 'PM', articles: [a('O', '1')], aVerifier: 'Groupe O à 1 %' },
  { num: 28, titre: 'Vente : 1 × P', type: 'FV', client: 'PM', articles: [a('P', '1')], aVerifier: 'Groupe P' },
  { num: 29, titre: 'Vente : 1 × A « HORS CHAMP »', type: 'FV', client: 'PM', articles: [a('A', '1', { code: 'HORS CHAMP', nom: 'Opération hors champ (test)' })], aVerifier: 'Code d’article « HORS CHAMP »' },
];

/** Les groupes que le cas demande et que l'entreprise n'a pas déclarés (vide = le cas se fait). */
export function groupesManquants(c: CasTestDgi, autorises: readonly GroupeTaxation[]): GroupeTaxation[] {
  return [...new Set(c.articles.map((x) => x.groupe))].filter((g) => !autorises.includes(g));
}

/** Les cas dont un avoir dépend (faits d'abord, dans le même mode). */
export function dependances(num: number): number[] {
  const c = CAS_TESTS_DGI.find((x) => x.num === num);
  return c?.avoir?.origine ? [c.avoir.origine] : [];
}

/** Les articles du cas, tels que le moteur de facture les attend. */
export function articlesDuCas(c: CasTestDgi) {
  return c.articles.map((x, i) => {
    const prix = x.prixCents ?? PRIX_REFERENCE[x.groupe]!;
    const q = Number(x.quantite);
    return {
      nom: x.nom ?? NOMS[x.groupe] ?? `Article ${x.groupe} (test)`,
      code: x.code ?? `TEST-${c.num}-${i + 1}`,
      type: x.type ?? 'BIE',
      groupe: x.groupe,
      prixUnitaireCents: prix,
      quantite: x.quantite,
      ...(x.taxeSpecifiqueParUniteCents ? { taxeSpecifiqueCents: Math.round(x.taxeSpecifiqueParUniteCents * q) } : {}),
      ...(x.remise ? { prixOrigineCents: x.remise.prixOrigineCents, modificationPrix: x.remise.motif } : {}),
    };
  });
}

/** Le client du cas : les noms et NIF de test sont réglables à l'écran. */
export interface ClientsTest {
  nif: string;
  nomPM?: string;
  nomPC?: string;
  nomPL?: string;
  nomAO?: string;
  referenceAO?: string;
}

export function clientDuCas(c: CasTestDgi, cl: ClientsTest): ClientFacture {
  switch (c.client) {
    case 'PP':
      return { type: 'PP' };
    case 'PM':
      return { type: 'PM', nom: cl.nomPM || 'CLIENT TEST SARL', nif: cl.nif, adresse: 'Kinshasa' };
    case 'PC':
      return { type: 'PC', nom: cl.nomPC || 'COMMERÇANT TEST', nif: cl.nif };
    case 'PL':
      return { type: 'PL', nom: cl.nomPL || 'CABINET TEST (profession libérale)', nif: cl.nif };
    case 'AO':
      return { type: 'AO', nom: cl.nomAO || 'ORGANISATION INTERNATIONALE TEST', referenceExoneration: cl.referenceAO || 'EXO-TEST-001' };
  }
}

/** Identifiant de la facture d'un cas dans une campagne (source « manual ») : une campagne ne fait chaque cas qu'une fois. */
export const sourceDuCas = (campagne: string, mode: 'ttc' | 'ht', num: number) => `dgi-test:${campagne}:${mode}:${num}`;
export const CAMPAGNE_VALIDE = /^[A-Za-z0-9-]{1,40}$/;
