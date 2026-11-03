import { formatCurrency } from '@/lib/utils';
import type { ReceiptLine } from './types';

/**
 * Rapports X, Z et A de la facture normalisée en lignes d'impression (note de service 01/022, 1.3.3 et 1.4.2) :
 * dénomination, NIF, date et heure, type et période du rapport, ISF ; montants total / taxable / taxe par type de
 * facture et par groupe ; nombre de factures par type ; paiements par mode ; réductions ; avoirs ; ventes incomplètes ;
 * dépôts et retraits d'espèces. Le rapport A liste chaque article (code, nom, prix, taux, vendu, retourné, en stock).
 */
interface Groupe {
  groupe: string;
  taux: number;
  totalCents: number;
  baseCents: number;
  tvaCents: number;
}

export interface VueRapportFiscal {
  id: string;
  type: 'X' | 'XP' | 'Z' | 'A';
  libelle: string;
  seq: number;
  debut: string;
  fin: string;
  cree_le: string;
  duplicata: boolean;
  vendeur: { denomination: string; nif: string; adresse?: string };
  isf: string | null;
  nim: string | null;
  environnement?: string;
  operateur: string;
  // X, XP, Z
  parType?: { type: string; libelle: string; nombre: number; totalCents: number; baseCents: number; tvaCents: number; groupes: Groupe[] }[];
  ventes?: { nombre: number; totalCents: number; tvaCents: number };
  avoirs?: { nombre: number; totalCents: number; tvaCents: number };
  net?: { totalCents: number; tvaCents: number };
  paiements?: { moyen: string; totalCents: number }[];
  remboursements?: { moyen: string; totalCents: number }[];
  reductions?: { lignes: number; montantCents: number; remisesRrrCents: number };
  taxeSpecifiqueCents?: number;
  incompletes?: { nombre: number; provisoires: number; enEchec: number };
  especes?: { devise: string; depotsCents: number; retraitsCents: number }[];
  // A
  articles?: {
    code: string | null;
    nom: string;
    groupe: string;
    taux: number;
    prixUnitaireCents: number;
    vendu: string;
    retourne: string;
    montantVenduCents: number;
    montantRetourneCents: number;
    enStock: number | null;
  }[];
  totaux?: Record<string, number>;
}

export const MOYENS_RAPPORT: Record<string, string> = {
  ESPECES: 'Espèces',
  VIREMENT: 'Virement',
  CARTEBANCAIRE: 'Carte bancaire',
  MOBILEMONEY: 'Mobile Money',
  CHEQUES: 'Chèque',
  CREDIT: 'Crédit',
  AUTRE: 'ScanLinkPay',
};

const cdf = (c: number) => formatCurrency(c, 'CDF');
/** Heure de Kinshasa (UTC+1), comme sur les factures. */
export const dateRapport = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const qte = (q: string) => Number(q).toLocaleString('fr-FR', { maximumFractionDigits: 3 });

export function titreRapport(r: Pick<VueRapportFiscal, 'type' | 'seq'>) {
  if (r.type === 'Z') return `RAPPORT Z N° ${r.seq}`;
  if (r.type === 'A') return `RAPPORT A N° ${r.seq}`;
  return r.type === 'XP' ? 'RAPPORT X PÉRIODIQUE' : 'RAPPORT X';
}

export function buildRapportFiscal(r: VueRapportFiscal): ReceiptLine[] {
  const lines: ReceiptLine[] = [{ type: 'title', text: r.vendeur.denomination || 'Entreprise' }];
  if (r.vendeur.nif) lines.push({ type: 'text', text: `NIF : ${r.vendeur.nif}`, align: 'center' });
  if (r.vendeur.adresse) lines.push({ type: 'text', text: r.vendeur.adresse, align: 'center', small: true });
  lines.push({ type: 'separator' }, { type: 'subtitle', text: titreRapport(r) });
  if (r.duplicata) lines.push({ type: 'subtitle', text: '*** DUPLICATA ***' });
  if (r.environnement === 'test') lines.push({ type: 'text', text: 'Environnement de TEST de la DGI', align: 'center', small: true });
  lines.push(
    { type: 'field', label: 'Du', value: dateRapport(r.debut) },
    { type: 'field', label: 'Au', value: dateRapport(r.fin) },
    { type: 'field', label: 'Édité le', value: dateRapport(r.cree_le) },
  );
  if (r.isf) lines.push({ type: 'field', label: 'ISF', value: r.isf });
  if (r.nim) lines.push({ type: 'field', label: 'NIM', value: r.nim });
  lines.push({ type: 'field', label: 'Opérateur', value: r.operateur }, { type: 'separator' });

  if (r.type === 'A') {
    for (const a of r.articles ?? []) {
      lines.push({ type: 'text', text: `${a.nom} [${a.groupe}] ${a.taux} %` });
      if (a.code) lines.push({ type: 'text', text: `  Code ${a.code}`, small: true });
      lines.push({ type: 'field', label: '  Prix unitaire', value: cdf(a.prixUnitaireCents) });
      lines.push({ type: 'field', label: '  Vendu', value: `${qte(a.vendu)} · ${cdf(a.montantVenduCents)}` });
      if (Number(a.retourne)) lines.push({ type: 'field', label: '  Retourné', value: `${qte(a.retourne)} · ${cdf(a.montantRetourneCents)}` });
      lines.push({ type: 'field', label: '  En stock', value: a.enStock === null ? '—' : a.enStock.toLocaleString('fr-FR') });
    }
    if (!r.articles?.length) lines.push({ type: 'text', text: 'Aucun article vendu sur la période.', align: 'center', small: true });
    lines.push(
      { type: 'separator' },
      { type: 'field', label: 'Articles', value: String(r.totaux?.articles ?? 0) },
      { type: 'field', label: 'Total vendu', value: cdf(r.totaux?.vendu_cents ?? 0) },
      { type: 'field', label: 'Total retourné', value: cdf(r.totaux?.retourne_cents ?? 0) },
      { type: 'text', text: ' ' },
    );
    return lines;
  }

  // Par type de facture, puis par groupe (1.3.3 g, h, i).
  for (const t of r.parType ?? []) {
    lines.push({ type: 'text', text: `${t.type} — ${t.libelle} : ${t.nombre}` });
    for (const g of t.groupes) {
      lines.push({ type: 'field', label: `  Groupe ${g.groupe}${g.groupe === 'N' ? '' : ` (${g.taux} %)`}`, value: cdf(g.totalCents) });
      if (g.taux || g.tvaCents) {
        lines.push({ type: 'field', label: '    Base', value: cdf(g.baseCents) }, { type: 'field', label: '    TVA', value: cdf(g.tvaCents) });
      }
    }
    lines.push(
      { type: 'field', label: '  Total', value: cdf(t.totalCents) },
      { type: 'field', label: '  Montant taxable', value: cdf(t.baseCents) },
      { type: 'field', label: '  Taxe', value: cdf(t.tvaCents) },
    );
  }
  if (!r.parType?.length) lines.push({ type: 'text', text: 'Aucune facture normalisée sur la période.', align: 'center', small: true });
  lines.push({ type: 'separator' });

  lines.push(
    { type: 'field', label: `Ventes (${r.ventes?.nombre ?? 0})`, value: cdf(r.ventes?.totalCents ?? 0) },
    { type: 'field', label: `Avoirs (${r.avoirs?.nombre ?? 0})`, value: `- ${cdf(r.avoirs?.totalCents ?? 0)}` },
    { type: 'amount', label: 'NET TTC', value: cdf(r.net?.totalCents ?? 0), large: true },
    { type: 'field', label: 'TVA nette', value: cdf(r.net?.tvaCents ?? 0) },
  );
  if (r.taxeSpecifiqueCents) lines.push({ type: 'field', label: 'Taxe spécifique', value: cdf(r.taxeSpecifiqueCents) });
  lines.push({ type: 'separator' }, { type: 'subtitle', text: 'PAIEMENTS' });
  for (const p of r.paiements ?? []) lines.push({ type: 'field', label: MOYENS_RAPPORT[p.moyen] ?? p.moyen, value: cdf(p.totalCents) });
  if (!r.paiements?.length) lines.push({ type: 'text', text: '—', align: 'center', small: true });
  if (r.remboursements?.length) {
    lines.push({ type: 'text', text: 'Remboursés (avoirs)', small: true });
    for (const p of r.remboursements) lines.push({ type: 'field', label: `  ${MOYENS_RAPPORT[p.moyen] ?? p.moyen}`, value: `- ${cdf(p.totalCents)}` });
  }
  lines.push(
    { type: 'separator' },
    { type: 'field', label: `Réductions (${r.reductions?.lignes ?? 0} lignes)`, value: cdf(r.reductions?.montantCents ?? 0) },
  );
  if (r.reductions?.remisesRrrCents) lines.push({ type: 'field', label: 'Rabais, remises, ristournes', value: cdf(r.reductions.remisesRrrCents) });
  lines.push(
    { type: 'field', label: 'Ventes incomplètes', value: String(r.incompletes?.nombre ?? 0) },
    { type: 'text', text: `  dont ${r.incompletes?.provisoires ?? 0} bon(s) provisoire(s), ${r.incompletes?.enEchec ?? 0} à traiter`, small: true },
  );
  if (r.especes?.length) {
    lines.push({ type: 'separator' }, { type: 'subtitle', text: 'ESPÈCES (TIROIR)' });
    for (const e of r.especes) {
      lines.push(
        { type: 'field', label: `Dépôts ${e.devise}`, value: formatCurrency(e.depotsCents, e.devise) },
        { type: 'field', label: `Retraits ${e.devise}`, value: formatCurrency(e.retraitsCents, e.devise) },
      );
    }
  }
  if (r.type === 'Z') lines.push({ type: 'separator' }, { type: 'text', text: `Période close — le prochain Z portera le n° ${r.seq + 1}.`, align: 'center', small: true });
  lines.push({ type: 'text', text: ' ' });
  return lines;
}
