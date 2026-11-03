import { formatCurrency } from '@/lib/utils';
import type { ReceiptLine } from './types';

/**
 * La facture normalisée (DGI) en lignes d'impression — ticket thermique, aperçu et impression système. Mentions
 * obligatoires de la note de service 01/022 (1.2.1 a à x) : vendeur (dénomination, NIF, adresse, contacts, régime),
 * client, DUPLICATA / FACTURE D'AVOIR / EXPORTATION / D'ACOMPTE, numéro, articles avec groupe et remises, totaux par
 * groupe, taux, TVA, total TTC en lettres, équivalent USD, paiements, date et heure, ISF, opérateur, éléments de
 * sécurité et code QR. Tant qu'elle n'est pas normalisée, c'est un BON PROVISOIRE NON FISCAL, sans QR.
 */
export interface VueFactureNormalisee {
  facture: {
    id: string;
    rn: string;
    type: string;
    type_libelle: string;
    mode: 'ttc' | 'ht';
    status: string;
    duplicata: boolean;
    provisoire: boolean;
    date_heure: string | null;
    cree_le: string;
    code_def_dgi: string | null;
    qr_code: string | null;
    compteurs: string | null;
    nim: string | null;
    isf: string | null;
    operateur: string;
    avoir: { nature: string; libelle: string; reference: string | null; origine: { rn: string; code_def_dgi: string } | null } | null;
    erreur: { code: string; description: string } | null;
  };
  vendeur: { denomination: string; nif: string; regime: string; adresse: string; telephone: string; email: string };
  client: { type?: string; type_libelle?: string; nom?: string; nif?: string; contact?: string; adresse?: string; referenceExoneration?: string };
  articles: {
    ligne_id: string;
    nom: string;
    code: string | null;
    type: string;
    groupe: string;
    unite: string | null;
    quantite: number;
    prix_unitaire_cents: number;
    prix_origine_cents: number | null;
    modification: string | null;
    taxe_specifique_cents: number | null;
    montant_cents: number;
  }[];
  groupes: { groupe: string; taux: number; totalCents: number; baseCents: number; tvaCents: number; libelle: string }[];
  total_cents: number;
  tva_cents: number;
  taxe_specifique_cents: number;
  total_en_lettres: string;
  equivalent_devise: { devise: string; taux: string; montant_cents: number } | null;
  paiements: { moyen: string; montantCents: number; devise?: string; taux?: string }[];
  commentaires: { code: string; texte: string }[];
}

const MOYENS: Record<string, string> = {
  ESPECES: 'Espèces',
  VIREMENT: 'Virement',
  CARTEBANCAIRE: 'Carte bancaire',
  MOBILEMONEY: 'Mobile Money',
  CHEQUES: 'Chèque',
  CREDIT: 'Crédit',
  AUTRE: 'ScanLinkPay',
};

const cdf = (c: number) => formatCurrency(c, 'CDF');
const qte = (q: number) => (Number.isInteger(q) ? String(q) : q.toLocaleString('fr-FR', { maximumFractionDigits: 3 }));

export function buildFactureNormalisee(v: VueFactureNormalisee): ReceiptLine[] {
  const f = v.facture;
  const lines: ReceiptLine[] = [{ type: 'title', text: v.vendeur.denomination || 'Entreprise' }];
  if (v.vendeur.nif) lines.push({ type: 'text', text: `NIF : ${v.vendeur.nif}`, align: 'center' });
  lines.push({ type: 'text', text: v.vendeur.regime, align: 'center', small: true });
  if (v.vendeur.adresse) lines.push({ type: 'text', text: v.vendeur.adresse, align: 'center', small: true });
  const contacts = [v.vendeur.telephone, v.vendeur.email].filter(Boolean).join(' · ');
  if (contacts) lines.push({ type: 'text', text: contacts, align: 'center', small: true });
  lines.push({ type: 'separator' });

  if (f.provisoire) {
    lines.push({ type: 'subtitle', text: 'BON PROVISOIRE — NON FISCAL' });
    lines.push({ type: 'text', text: 'En attente de normalisation par la DGI. La facture normalisée sera remise dès le retour du réseau.', align: 'center', small: true });
  } else {
    lines.push({ type: 'subtitle', text: f.type_libelle.toUpperCase() });
    if (f.duplicata) lines.push({ type: 'subtitle', text: '*** DUPLICATA ***' });
  }
  if (f.avoir) {
    lines.push({ type: 'text', text: `Nature : ${f.avoir.libelle}`, align: 'center' });
    lines.push({ type: 'text', text: `Réf. facture d'origine : ${f.avoir.origine?.rn ? `${f.avoir.origine.rn} — ` : ''}${f.avoir.reference ?? ''}`, align: 'center', small: true });
  }
  lines.push(
    { type: 'field', label: `N° ${f.rn}`, value: f.date_heure ?? new Date(f.cree_le).toLocaleString('fr-FR') },
    { type: 'field', label: 'Prix unitaires', value: f.mode === 'ttc' ? 'TTC' : 'HT' },
    { type: 'separator' },
  );

  // Client : type obligatoire, et ses informations quand il les demande.
  lines.push({ type: 'field', label: 'Client', value: `[${v.client.type ?? 'PP'}] ${v.client.type_libelle ?? ''}`.trim() });
  if (v.client.nom) lines.push({ type: 'text', text: v.client.nom });
  if (v.client.nif) lines.push({ type: 'text', text: `NIF : ${v.client.nif}` });
  if (v.client.adresse) lines.push({ type: 'text', text: v.client.adresse, small: true });
  if (v.client.contact) lines.push({ type: 'text', text: v.client.contact, small: true });
  lines.push({ type: 'separator' });

  for (const a of v.articles) {
    lines.push({ type: 'text', text: `${a.nom} [${a.groupe}] [${a.type}]${a.code ? ` · ${a.code}` : ''}` });
    lines.push({ type: 'field', label: `  ${qte(a.quantite)}${a.unite ? ` ${a.unite}` : ''} x ${cdf(a.prix_unitaire_cents)}`, value: cdf(a.montant_cents) });
    if (a.prix_origine_cents) lines.push({ type: 'text', text: `  Prix d'origine ${cdf(a.prix_origine_cents)} — ${a.modification ?? 'remise'}`, small: true });
    if (a.taxe_specifique_cents) lines.push({ type: 'text', text: `  Taxe spécifique ${cdf(a.taxe_specifique_cents)}`, small: true });
  }
  lines.push({ type: 'separator' });

  for (const g of v.groupes) {
    lines.push({ type: 'field', label: `Groupe ${g.groupe}${g.groupe === 'N' ? ' (TVA)' : ` (${g.taux} %)`}`, value: cdf(g.totalCents) });
    if (g.tvaCents || g.taux) {
      lines.push({ type: 'field', label: '  Base imposable', value: cdf(g.baseCents) });
      lines.push({ type: 'field', label: '  TVA', value: cdf(g.tvaCents) });
    }
  }
  if (v.taxe_specifique_cents) lines.push({ type: 'field', label: 'Taxe spécifique', value: cdf(v.taxe_specifique_cents) });
  lines.push(
    { type: 'field', label: 'Total TVA', value: cdf(v.tva_cents) },
    { type: 'amount', label: 'TOTAL TTC', value: cdf(v.total_cents), large: true },
    { type: 'text', text: v.total_en_lettres, small: true },
  );
  if (v.equivalent_devise) {
    lines.push(
      { type: 'field', label: `Équivalent ${v.equivalent_devise.devise}`, value: formatCurrency(v.equivalent_devise.montant_cents, v.equivalent_devise.devise) },
      { type: 'text', text: `Taux : 1 ${v.equivalent_devise.devise} = ${Number(v.equivalent_devise.taux).toLocaleString('fr-FR')} CDF`, small: true },
    );
  }
  lines.push({ type: 'separator' });
  for (const p of v.paiements) {
    lines.push({ type: 'field', label: `${MOYENS[p.moyen] ?? p.moyen}${p.devise ? ` (${p.devise})` : ''}`, value: cdf(p.montantCents) });
  }
  if (v.commentaires.length) {
    lines.push({ type: 'separator' });
    for (const c of v.commentaires) lines.push({ type: 'text', text: c.texte, small: true });
  }
  lines.push({ type: 'separator' }, { type: 'field', label: 'Opérateur', value: f.operateur });
  if (f.isf) lines.push({ type: 'field', label: 'ISF', value: f.isf });

  if (!f.provisoire && f.code_def_dgi) {
    lines.push(
      { type: 'separator' },
      { type: 'subtitle', text: 'ÉLÉMENTS DE SÉCURITÉ' },
      { type: 'text', text: `Code DEF/DGI : ${f.code_def_dgi}`, align: 'center' },
    );
    if (f.nim) lines.push({ type: 'field', label: 'NIM', value: f.nim });
    if (f.compteurs) lines.push({ type: 'field', label: 'Compteurs', value: f.compteurs });
    if (f.date_heure) lines.push({ type: 'field', label: 'Date DGI', value: f.date_heure });
    if (f.qr_code) lines.push({ type: 'qr', value: f.qr_code });
  }
  lines.push({ type: 'text', text: ' ' });
  return lines;
}
