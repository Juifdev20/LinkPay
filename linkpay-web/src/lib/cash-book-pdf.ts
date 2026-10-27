import { jsPDF } from 'jspdf';
import {
  PDF, drawFooters, drawHeader, drawKpis, drawSignatures, drawTable, sectionTitle, pdfDay, pdfHour, pdfMoney, pdfStamp, signed,
  type Cell, type PdfOrg, type Row,
} from '@/lib/pdf-kit';

const KIND_LABELS: Record<string, string> = {
  sale: 'Vente',
  cash_in: 'Entrée de caisse',
  expense: 'Dépense',
  cash_out: 'Sortie de caisse',
  adjustment: 'Écart de caisse',
};

const monthLabel = (key: string) => new Date(`${key}-15T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
const gapColor = (cents: number) => (cents === 0 ? PDF.green : cents > 0 ? PDF.amber : PDF.red);
const gapText = (cents: number, c: string) => (cents === 0 ? 'Caisse juste' : `${signed(cents, c)} ${cents > 0 ? '(excédent)' : '(manquant)'}`);

export interface CashPdfMeta {
  org?: PdfOrg | null;
  stationName?: string;
  /** Names of the station's cashiers (printed under "Le caissier"). */
  cashiers?: string[];
  /** The person who prints / closes, when they are the cashier. */
  signer?: string | null;
  /** Binder section shown above the title ("Classeur 2026 · Mensuel · Octobre"). */
  tag?: string;
  /** Append the report to this document (new page, no footer: the caller adds the footers at the end). */
  into?: jsPDF;
}

/** The label of a period report (GET cash-book/report), as shown on screen and in the PDF header. */
export function reportPeriodLabel(x: { period: string; first_day: string; last_day: string }): string {
  const short = (k: string) => pdfDay(k, false);
  if (x.period === 'day') return pdfDay(x.first_day);
  if (x.period === 'week') return `Semaine du ${short(x.first_day)} au ${short(x.last_day)}`;
  if (x.period === 'month') return monthLabel(x.first_day.slice(0, 7));
  return `Année ${x.first_day.slice(0, 4)}`;
}

/** Who signs: the signed-in cashier, else the station's configured cashier(s). */
function cashierLine(meta: CashPdfMeta): string | undefined {
  if (meta.signer) return meta.signer;
  const names = (meta.cashiers || []).filter(Boolean);
  return names.length ? names.join(' / ') : undefined;
}

function start(meta: CashPdfMeta, title: string, subtitle: string, period: string, currency: string) {
  const doc = meta.into ?? new jsPDF();
  if (meta.into) doc.addPage();
  const y = drawHeader(doc, { title, subtitle: meta.tag ? `${meta.tag}  ·  ${subtitle}` : subtitle, meta: { org: meta.org, stationName: meta.stationName }, period, currency });
  return { doc, y };
}

function finish(doc: jsPDF, y: number, meta: CashPdfMeta) {
  drawSignatures(doc, y, { cashier: cashierLine(meta) });
  if (!meta.into) drawFooters(doc, meta.org?.legal_name || meta.org?.name);
  return doc;
}

/** The monthly cash book (GET cash-book/month): every cash receipt and payment in order, with opening and closing balance. */
export function buildCashBookPdf(book: any, meta: CashPdfMeta): jsPDF {
  const c = book.currency;
  const { doc, y: y0 } = start(meta, 'LIVRE DE CAISSE', `Journal des encaissements et décaissements · ${monthLabel(book.month)}`, monthLabel(book.month), c);
  let y = drawKpis(doc, y0, [
    { label: "Solde d'ouverture", value: pdfMoney(book.opening_cents, c) },
    { label: 'Encaissements', value: pdfMoney(book.receipts_cents, c), tone: 'in' },
    { label: 'Décaissements', value: pdfMoney(book.payments_cents, c), tone: 'out' },
    { label: 'Écarts de caisse', value: signed(book.discrepancy_cents, c), tone: book.discrepancy_cents ? 'warn' : undefined },
    { label: 'Solde de clôture', value: pdfMoney(book.closing_cents, c), tone: 'main' },
  ]);

  if (book.unclosed_days?.length) {
    doc.setFontSize(8.5);
    doc.setTextColor(...PDF.amber);
    doc.text(`Journées non clôturées : ${book.unclosed_days.map((d: string) => pdfDay(d, false)).join(', ')}`.slice(0, 150), 14, y - 2);
    doc.setTextColor(...PDF.text);
    y += 6;
  }

  const columns = [
    { title: 'Heure', width: 13 }, { title: 'Libellé', width: 50 }, { title: 'Pièce', width: 31 },
    { title: 'Encaissement', width: 28, align: 'right' as const }, { title: 'Décaissement', width: 28, align: 'right' as const }, { title: 'Solde', width: 28, align: 'right' as const },
  ];
  for (const d of book.days) {
    y = sectionTitle(doc, y, `${pdfDay(d.day)}${d.closed ? '' : '  ·  non clôturée'}`);
    const rows: Row[] = [{ kind: 'sub', cells: ['', "Solde d'ouverture", '', '', '', pdfMoney(d.opening_cents, c)] }];
    for (const e of d.entries) {
      const label = `${KIND_LABELS[e.kind] || ''}${e.label && e.kind !== 'adjustment' ? ` · ${e.label}` : ''}${e.by ? ` (${e.by})` : ''}`;
      rows.push({
        cells: [
          pdfHour(e.at), label, e.ref || '',
          e.direction === 'in' ? { text: pdfMoney(e.amount_cents, c), color: PDF.green } : '',
          e.direction === 'out' ? { text: pdfMoney(e.amount_cents, c), color: PDF.red } : '',
          pdfMoney(e.balance_cents ?? 0, c),
        ],
      });
    }
    rows.push({
      kind: 'total',
      cells: ['', d.closed ? 'Total du jour · clôture (espèces comptées)' : 'Total du jour · fin de journée (non clôturée)', '', pdfMoney(d.receipts_cents, c), pdfMoney(d.payments_cents, c), pdfMoney(d.closing_cents, c)],
    });
    y = drawTable(doc, y, columns, rows);
  }
  if (!book.days.length) {
    y = sectionTitle(doc, y, 'Mouvements');
    y = drawTable(doc, y, columns, [], { emptyText: 'Aucun mouvement de caisse ce mois-ci.' });
  }
  return finish(doc, y, meta);
}

/** The report of a period (GET cash-book/report): day, week, month or year. */
export function buildCashReportPdf(r: any, meta: CashPdfMeta & { periodLabel: string }): jsPDF {
  const c = r.currency;
  const title = { day: 'RAPPORT JOURNALIER', week: 'RAPPORT HEBDOMADAIRE', month: 'RAPPORT MENSUEL', year: 'RAPPORT ANNUEL' }[r.period as string] || 'RAPPORT FINANCIER';
  const { doc, y: y0 } = start(meta, title, 'Rapport financier de la caisse', meta.periodLabel, c);
  let y = drawKpis(doc, y0, [
    { label: "Chiffre d'affaires", value: pdfMoney(r.turnover_cents, c), tone: 'main' },
    { label: 'Encaissé en espèces', value: pdfMoney(r.cash_sales_cents + r.cash_in_cents, c), tone: 'in' },
    { label: 'Dépenses et sorties', value: pdfMoney(r.expenses_cents + r.cash_out_cents, c), tone: 'out' },
    { label: 'Variation de la caisse', value: signed(r.net_cents, c) },
    { label: 'Écarts constatés', value: signed(r.discrepancy_cents, c), tone: r.discrepancy_cents ? 'warn' : undefined },
  ]);

  y = sectionTitle(doc, y, 'Synthèse');
  y = drawTable(doc, y, [{ title: 'Rubrique', width: 70 }, { title: 'Montant', width: 30, align: 'right' }], [
    { cells: ['Ventes en espèces', pdfMoney(r.cash_sales_cents, c)] },
    { cells: ['Entrées de caisse', pdfMoney(r.cash_in_cents, c)] },
    { cells: ['Dépenses validées', { text: pdfMoney(r.expenses_cents, c), color: PDF.red }] },
    { cells: ['Sorties de caisse', { text: pdfMoney(r.cash_out_cents, c), color: PDF.red }] },
    { kind: 'total', cells: ['Variation de la caisse (espèces)', signed(r.net_cents, c)] },
    { cells: ['Ventes hors caisse (ScanLinkPay…), non comptées dans les espèces', pdfMoney(r.non_cash_cents, c)] },
    { cells: ['Nombre de ventes · panier moyen', `${r.sales_count} · ${pdfMoney(r.average_ticket_cents, c)}`] },
  ]);

  const byYear = r.period === 'year';
  y = sectionTitle(doc, y, byYear ? 'Détail par mois' : 'Détail par jour');
  const series: Row[] = r.series.map((s: any) => ({
    cells: [byYear ? s.key : pdfDay(s.key, false), pdfMoney(s.cash_sales_cents + s.cash_in_cents, c), pdfMoney(s.non_cash_cents, c), pdfMoney(s.expenses_cents, c), pdfMoney(s.cash_out_cents, c)],
  }));
  series.push({
    kind: 'total',
    cells: ['Total', pdfMoney(r.cash_sales_cents + r.cash_in_cents, c), pdfMoney(r.non_cash_cents, c), pdfMoney(r.expenses_cents, c), pdfMoney(r.cash_out_cents, c)],
  });
  y = drawTable(doc, y, [
    { title: byYear ? 'Mois' : 'Jour', width: 28 }, { title: 'Espèces encaissées', width: 28, align: 'right' }, { title: 'Hors caisse', width: 26, align: 'right' },
    { title: 'Dépenses', width: 24, align: 'right' }, { title: 'Sorties', width: 24, align: 'right' },
  ], series);

  if (r.by_method.length) {
    y = sectionTitle(doc, y, 'Répartition par mode de paiement');
    const total = r.by_method.reduce((s: number, m: any) => s + m.amount_cents, 0) || 1;
    y = drawTable(doc, y, [{ title: 'Mode de paiement', width: 60 }, { title: 'Montant', width: 30, align: 'right' }, { title: 'Part', width: 16, align: 'right' }],
      r.by_method.map((m: any) => ({ cells: [m.method, pdfMoney(m.amount_cents, c), `${Math.round((m.amount_cents / total) * 100)} %`] })));
  }
  if (r.by_category.length) {
    y = sectionTitle(doc, y, 'Dépenses par catégorie');
    const total = r.by_category.reduce((s: number, m: any) => s + m.amount_cents, 0) || 1;
    y = drawTable(doc, y, [{ title: 'Catégorie', width: 60 }, { title: 'Montant', width: 30, align: 'right' }, { title: 'Part', width: 16, align: 'right' }],
      r.by_category.map((m: any) => ({ cells: [m.category, pdfMoney(m.amount_cents, c), `${Math.round((m.amount_cents / total) * 100)} %`] })));
  }
  if (r.by_seller.length) {
    y = sectionTitle(doc, y, 'Par vendeur / caissier');
    y = drawTable(doc, y, [{ title: 'Nom', width: 60 }, { title: 'Espèces', width: 30, align: 'right' }, { title: 'Hors caisse', width: 30, align: 'right' }],
      r.by_seller.map((s: any) => ({ cells: [s.by || '—', pdfMoney(s.cash_cents, c), pdfMoney(s.non_cash_cents, c)] })));
  }

  const closed = (r.closings || []).filter((x: any) => x.status === 'closed');
  y = sectionTitle(doc, y, 'Clôtures de caisse');
  y = drawTable(doc, y, [
    { title: 'Jour', width: 24 }, { title: 'Attendu', width: 24, align: 'right' }, { title: 'Compté', width: 24, align: 'right' }, { title: 'Écart', width: 28, align: 'right' }, { title: 'Clôturée par', width: 40 },
  ], closed.map((x: any) => ({
    cells: [pdfDay(x.day, false), pdfMoney(x.expected_cents, c), pdfMoney(x.counted_cents, c), { text: gapText(x.discrepancy_cents, c), color: gapColor(x.discrepancy_cents) }, `${x.closed_by_name || '—'}${x.closed_at ? `, ${pdfHour(x.closed_at)}` : ''}`],
  })), { emptyText: 'Aucune clôture sur cette période.' });

  if (r.unclosed_days.length) {
    y = sectionTitle(doc, y, 'Journées non clôturées');
    y = drawTable(doc, y, [{ title: 'Jour', width: 100 }], r.unclosed_days.map((d: string) => ({ cells: [{ text: pdfDay(d), color: PDF.amber }] })));
  }
  return finish(doc, y, meta);
}

/** The end-of-day closing as a one-page receipt (to print or send to the manager). */
export function buildClosingPdf(row: any, meta: CashPdfMeta & { closedBy?: string; unlocks?: any[] }): jsPDF {
  const c = row.currency;
  const closedBy = meta.closedBy || row.closed_by_name || undefined;
  const { doc, y: y0 } = start({ ...meta, signer: meta.signer ?? closedBy }, 'CLÔTURE DE CAISSE', pdfDay(row.business_day), `Journée du ${row.business_day.split('-').reverse().join('/')}`, c);
  let y = drawKpis(doc, y0, [
    { label: "Solde d'ouverture", value: pdfMoney(row.opening_cents, c) },
    { label: 'Espèces attendues', value: pdfMoney(row.expected_cents, c) },
    { label: 'Espèces comptées', value: pdfMoney(row.counted_cents, c), tone: 'main' },
    { label: 'Écart', value: signed(row.discrepancy_cents, c), tone: row.discrepancy_cents ? 'warn' : 'in' },
  ]);

  y = sectionTitle(doc, y, 'Détail de la caisse');
  y = drawTable(doc, y, [{ title: 'Rubrique', width: 70 }, { title: 'Montant', width: 30, align: 'right' }], [
    { cells: ["Solde d'ouverture", pdfMoney(row.opening_cents, c)] },
    { cells: ['+ Ventes en espèces', { text: pdfMoney(row.cash_sales_cents, c), color: PDF.green }] },
    { cells: ['+ Entrées de caisse', { text: pdfMoney(row.cash_in_cents, c), color: PDF.green }] },
    { cells: ['- Dépenses validées', { text: pdfMoney(row.expenses_cents, c), color: PDF.red }] },
    { cells: ['- Sorties de caisse', { text: pdfMoney(row.cash_out_cents, c), color: PDF.red }] },
    { kind: 'total', cells: ['= Espèces attendues', pdfMoney(row.expected_cents, c)] },
    { cells: ['Espèces comptées', pdfMoney(row.counted_cents, c)] },
    { kind: 'total', cells: [{ text: 'Écart (compté - attendu)', bold: true }, { text: gapText(row.discrepancy_cents, c), color: gapColor(row.discrepancy_cents), bold: true }] },
  ]);

  y = sectionTitle(doc, y, 'Activité du jour');
  y = drawTable(doc, y, [{ title: 'Indicateur', width: 70 }, { title: 'Valeur', width: 30, align: 'right' }], [
    { cells: ['Nombre de ventes', String(row.sales_count)] },
    { cells: ['Ventes hors caisse (non comptées dans les espèces)', pdfMoney(row.non_cash_cents, c)] },
    { cells: ['Clôture n°', String(row.version || 1)] },
    { cells: ['Clôturée le', pdfStamp(row.closed_at) || '—'] },
    { cells: ['Clôturée par', closedBy || '—'] },
  ]);
  if (row.note) {
    y = sectionTitle(doc, y, 'Note du caissier');
    y = drawTable(doc, y, [{ title: 'Note', width: 100 }], [{ cells: [row.note as Cell] }]);
  }
  if (meta.unlocks?.length) {
    y = sectionTitle(doc, y, 'Déverrouillages de la journée');
    y = drawTable(doc, y, [{ title: 'Date et heure', width: 36 }, { title: 'Par', width: 28 }, { title: 'Motif', width: 50 }],
      meta.unlocks.map((u: any) => ({ cells: [pdfStamp(u.created_at), u.user_name || '—', u.reason || '—'] })));
  }
  return finish(doc, y, { ...meta, signer: meta.signer ?? closedBy });
}
