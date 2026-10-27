import { jsPDF } from 'jspdf';
import logoSrc from '@/assets/logo.png';
import { PDF, drawFooters, pdfMoney, signed, MARGIN, type PdfOrg } from '@/lib/pdf-kit';
import { buildCashBookPdf, buildCashReportPdf, reportPeriodLabel, type CashPdfMeta } from '@/lib/cash-book-pdf';
import { binderColor, frDate, monthName, MONTHS_FR } from '@/lib/binder';

type RGB = [number, number, number];
const fill = (doc: jsPDF, c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
const ink = (doc: jsPDF, c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
const stroke = (doc: jsPDF, c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);
const clean = (s?: string | null) => (s || '').replace(/\s+/g, ' ').trim();

/** The metal eyelet of a lever-arch binder (grey rings around a hole). */
function eyelet(doc: jsPDF, cx: number, cy: number, r: number) {
  fill(doc, [120, 124, 132]);
  doc.circle(cx, cy, r, 'F');
  fill(doc, [196, 200, 208]);
  doc.circle(cx, cy, r * 0.82, 'F');
  fill(doc, [245, 246, 248]);
  doc.circle(cx, cy, r * 0.62, 'F');
  fill(doc, [150, 154, 162]);
  doc.circle(cx, cy, r * 0.62, 'S');
}

/** White spine label with dashed writing lines, like the labels on the binders of the picture. */
function spineLabel(doc: jsPDF, x: number, y: number, w: number, h: number, lines: number) {
  fill(doc, PDF.white);
  stroke(doc, [200, 202, 210]);
  doc.setLineWidth(0.3);
  doc.rect(x, y, w, h, 'FD');
  doc.setLineDashPattern([1.2, 1.2], 0);
  stroke(doc, [170, 172, 182]);
  doc.setLineWidth(0.2);
  const top = y + h * 0.4;
  const step = (h - (top - y) - 6) / lines;
  for (let i = 0; i < lines; i++) doc.line(x + 3, top + i * step, x + w - 3, top + i * step);
  doc.setLineDashPattern([], 0);
}

export interface BinderMeta extends CashPdfMeta {
  year: number;
  currency: string;
  /** Last day covered: the end of the year, or today for the current year. */
  to?: string;
}

/** The cover of a year's binder: coloured spine with its eyelet and label, the title and the identity of the station. */
export function drawBinderCover(doc: jsPDF, m: BinderMeta) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  const col = binderColor(m.year);
  // Cream edge of the pages, then the coloured cover.
  fill(doc, [250, 246, 232]);
  doc.rect(0, 0, w, h, 'F');
  fill(doc, col.rgb);
  doc.rect(0, 0, 62, h, 'F');
  fill(doc, col.rgb.map((v) => Math.max(0, v - 28)) as RGB);
  doc.rect(58, 0, 4, h, 'F');
  // Spine: lever mechanism, label, eyelet.
  fill(doc, [90, 92, 100]);
  doc.roundedRect(8, 24, 14, 5, 1, 1, 'F');
  doc.roundedRect(8, 60, 14, 5, 1, 1, 'F');
  spineLabel(doc, 24, 18, 30, 190, 7);
  // Rotated text reads bottom to top: start half its width below the label's centre.
  const upright = (text: string, x: number, size: number, bold: boolean, color: RGB) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    ink(doc, color);
    doc.text(text, x, 113 + doc.getTextWidth(text) / 2, { angle: 90 });
  };
  upright('CLASSEUR DE CAISSE', 32, 9, true, PDF.muted);
  upright(String(m.year), 45, 26, true, PDF.navy);
  upright(clean(m.stationName), 51.5, 8, false, PDF.text);
  eyelet(doc, 31, 244, 8);

  // Right side: title and identity.
  const x = 80;
  fill(doc, PDF.white);
  doc.roundedRect(x - 6, 30, w - x - 8, 150, 3, 3, 'F');
  doc.addImage(logoSrc, 'PNG', x, 40, 18, 18);
  ink(doc, PDF.navy);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('ScanLinkPay', x + 22, 52);
  doc.setFontSize(24);
  doc.text('CLASSEUR', x, 82);
  doc.text(`DE CAISSE ${m.year}`, x, 93);
  fill(doc, col.rgb);
  doc.rect(x, 98, 34, 2.2, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  ink(doc, PDF.text);
  const org = clean(m.org?.legal_name || m.org?.name);
  const lines: [string, string][] = [
    ['Entreprise', org],
    ['Station', clean(m.stationName)],
    ['Caisse', m.currency],
    ['Période', `du 01/01/${m.year} au ${m.to ? frDate(m.to) : `31/12/${m.year}`}`],
  ];
  lines.forEach(([k, v], i) => {
    ink(doc, PDF.muted);
    doc.setFontSize(8.5);
    doc.text(k.toUpperCase(), x, 118 + i * 11);
    ink(doc, PDF.text);
    doc.setFontSize(11.5);
    doc.setFont('helvetica', 'bold');
    doc.text(v || '—', x, 123.5 + i * 11, { maxWidth: w - x - 20 });
    doc.setFont('helvetica', 'normal');
  });
  ink(doc, PDF.muted);
  doc.setFontSize(8.5);
  doc.text(`Rapports journaliers, hebdomadaires, mensuels et annuel — classés par ordre chronologique.`, x, 170, { maxWidth: w - x - 20 });
  doc.text(`Édité le ${new Date().toLocaleDateString('fr-FR', { timeZone: 'Africa/Lubumbashi' })}`, x, 190);
}

/** Table of contents with dotted leaders and page numbers. */
function drawContents(doc: jsPDF, entries: { title: string; page: number; level: number }[], meta: BinderMeta) {
  const w = doc.internal.pageSize.getWidth();
  fill(doc, PDF.navy);
  doc.rect(0, 0, w, 24, 'F');
  ink(doc, PDF.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(`SOMMAIRE · CLASSEUR ${meta.year}`, MARGIN, 15);
  let y = 38;
  for (const e of entries) {
    if (y > 270) break;
    ink(doc, e.level ? PDF.text : PDF.navy);
    doc.setFont('helvetica', e.level ? 'normal' : 'bold');
    doc.setFontSize(e.level ? 10 : 11);
    const x = MARGIN + e.level * 8;
    doc.text(e.title, x, y);
    const tw = doc.getTextWidth(e.title);
    ink(doc, [170, 172, 182]);
    const dots = '.'.repeat(Math.max(3, Math.floor((w - MARGIN - 14 - x - tw) / 1.4)));
    doc.text(dots, x + tw + 2, y);
    ink(doc, e.level ? PDF.text : PDF.navy);
    doc.text(String(e.page), w - MARGIN, y, { align: 'right' });
    y += e.level ? 6.5 : 9;
  }
}

export interface BinderYearData {
  year: any;
  months: { month0: number; report: any; book: any }[];
}

/**
 * A year's whole binder as one PDF: cover, contents, the annual report, then month after month the monthly report and
 * the cash book (its journal runs day by day). Everything is chronological; pages are numbered from the cover.
 */
export function buildBinderYearPdf(data: BinderYearData, meta: BinderMeta): jsPDF {
  const doc = new jsPDF();
  drawBinderCover(doc, meta);
  doc.addPage(); // the contents, filled in once the page numbers are known
  const contents: { title: string; page: number; level: number }[] = [];
  const base = { ...meta, into: doc };

  const mark = (title: string, level: number) => contents.push({ title, level, page: doc.getNumberOfPages() + 1 });
  mark(`Rapport annuel ${meta.year}`, 0);
  buildCashReportPdf(data.year, { ...base, tag: `Classeur ${meta.year} · Annuel`, periodLabel: reportPeriodLabel(data.year) });
  for (const m of data.months) {
    const name = monthName(meta.year, m.month0);
    mark(name.charAt(0).toUpperCase() + name.slice(1), 0);
    mark('Rapport mensuel', 1);
    buildCashReportPdf(m.report, { ...base, tag: `Classeur ${meta.year} · Mensuel · ${MONTHS_FR[m.month0]}`, periodLabel: reportPeriodLabel(m.report) });
    mark('Livre de caisse du mois (journal jour par jour)', 1);
    buildCashBookPdf(m.book, { ...base, tag: `Classeur ${meta.year} · Livre de caisse · ${MONTHS_FR[m.month0]}` });
  }
  doc.setPage(2);
  drawContents(doc, contents, meta);
  drawFooters(doc, meta.org?.legal_name || meta.org?.name, true);
  return doc;
}

/** The label to print and stick on the spine of a real binder (70 × 200 mm). */
export function buildBinderLabelPdf(meta: { year: number; org?: PdfOrg | null; stationName?: string; currency: string }): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: [70, 200] });
  const col = binderColor(meta.year);
  fill(doc, PDF.white);
  doc.rect(0, 0, 70, 200, 'F');
  fill(doc, col.rgb);
  doc.rect(0, 0, 70, 6, 'F');
  doc.rect(0, 194, 70, 6, 'F');
  stroke(doc, [200, 202, 210]);
  doc.setLineWidth(0.4);
  doc.rect(3, 9, 64, 182, 'S');
  doc.addImage(logoSrc, 'PNG', 8, 14, 12, 12);
  ink(doc, PDF.navy);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('ScanLinkPay', 23, 22);
  doc.setFontSize(10);
  doc.text('CLASSEUR DE CAISSE', 35, 42, { align: 'center' });
  doc.setFontSize(34);
  doc.text(String(meta.year), 35, 64, { align: 'center' });
  fill(doc, col.rgb);
  doc.rect(22, 69, 26, 1.8, 'F');
  doc.setFontSize(11);
  doc.text(clean(meta.stationName), 35, 82, { align: 'center', maxWidth: 58 });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  ink(doc, PDF.muted);
  doc.text(clean(meta.org?.legal_name || meta.org?.name), 35, 92, { align: 'center', maxWidth: 58 });
  doc.text(`Caisse ${meta.currency}`, 35, 98, { align: 'center' });
  doc.setLineDashPattern([1.2, 1.2], 0);
  stroke(doc, [170, 172, 182]);
  doc.setLineWidth(0.2);
  for (let i = 0; i < 6; i++) doc.line(8, 112 + i * 13, 62, 112 + i * 13);
  doc.setLineDashPattern([], 0);
  return doc;
}

/** Used by the shelf: "12 500 $US" style totals for a year. */
export const yearSummary = (y: { receipts_cents: number; payments_cents: number; discrepancy_cents: number }, c: string) => ({
  receipts: pdfMoney(y.receipts_cents, c),
  payments: pdfMoney(y.payments_cents, c),
  gap: signed(y.discrepancy_cents, c),
});
