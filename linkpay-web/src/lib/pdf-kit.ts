import type { jsPDF } from 'jspdf';
import logoSrc from '@/assets/logo.png';
import { formatCurrency } from '@/lib/utils';

type RGB = [number, number, number];

/** Brand palette of the PDF reports (same colours as --brand-* / --primary in index.css). */
export const PDF = {
  navy: [10, 18, 112] as RGB,
  blue: [18, 48, 248] as RGB,
  sky: [21, 184, 254] as RGB,
  paleBlue: [243, 245, 255] as RGB,
  line: [223, 227, 245] as RGB,
  text: [30, 30, 40] as RGB,
  muted: [110, 110, 130] as RGB,
  green: [5, 150, 105] as RGB,
  red: [225, 29, 72] as RGB,
  amber: [217, 119, 6] as RGB,
  white: [255, 255, 255] as RGB,
};

export const MARGIN = 14;
const PAGE_BOTTOM = 280;
const CONTENT_TOP = 18;

/** formatCurrency uses narrow/no-break spaces the PDF base fonts can't draw. */
export const pdfMoney = (cents: number, currency: string) => formatCurrency(cents || 0, currency).replace(/[  ]/g, ' ').replace(/[,.]00(?=\D*$)/, '');
export const signed = (cents: number, currency: string) => `${cents > 0 ? '+' : ''}${pdfMoney(cents, currency)}`;
export const pdfDay = (key: string, long = true) =>
  new Date(`${key}T12:00:00`).toLocaleDateString('fr-FR', long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } : { weekday: 'short', day: '2-digit', month: '2-digit' });
export const pdfHour = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lubumbashi' }) : '');
export const pdfStamp = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Africa/Lubumbashi' }) : '';
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

export interface PdfOrg {
  name?: string;
  legal_name?: string | null;
  scanlinkpay_number?: string | null;
  contact?: { address?: { avenue?: string; number?: string; commune?: string; city?: string; country?: string } } | null;
  owner_phone?: string | null;
}

export interface PdfMeta {
  org?: PdfOrg | null;
  stationName?: string;
  /** Printed on every page footer. */
  footerName?: string;
}

const fill = (doc: jsPDF, c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
const ink = (doc: jsPDF, c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
const stroke = (doc: jsPDF, c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);

function addressOf(org?: PdfOrg | null) {
  const a = org?.contact?.address;
  return clean([a?.avenue && `Av. ${a.avenue}${a.number ? ` n° ${a.number}` : ''}`, a?.commune, a?.city, a?.country].filter(Boolean).join(', '));
}

/**
 * First page header: a navy-to-blue band (the brand gradient, drawn in slices) with the logo and the document title,
 * then the business identity (name, address, phone), the station and the period.
 */
export function drawHeader(doc: jsPDF, opts: { title: string; subtitle?: string; meta: PdfMeta; period?: string; currency?: string }): number {
  const w = doc.internal.pageSize.getWidth();
  const steps = 48;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const c = PDF.navy.map((v, k) => Math.round(v + (PDF.blue[k] - v) * t)) as RGB;
    fill(doc, c);
    doc.rect((w / steps) * i, 0, w / steps + 0.4, 30, 'F');
  }
  fill(doc, PDF.sky);
  doc.rect(0, 30, w, 1.2, 'F');
  // White disc behind the logo so it reads on the dark band.
  fill(doc, PDF.white);
  doc.circle(MARGIN + 8, 15, 9, 'F');
  doc.addImage(logoSrc, 'PNG', MARGIN + 1.5, 8.5, 13, 13);

  ink(doc, PDF.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text(opts.title, MARGIN + 22, 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  if (opts.subtitle) doc.text(opts.subtitle, MARGIN + 22, 20.5);
  doc.setFontSize(8);
  doc.text(`Édité le ${new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Lubumbashi' })}`, w - MARGIN, 11, { align: 'right' });
  doc.text('ScanLinkPay', w - MARGIN, 16, { align: 'right' });

  // Identity block.
  const org = opts.meta.org;
  let y = 39;
  ink(doc, PDF.navy);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(clean(org?.legal_name || org?.name || 'Entreprise'), MARGIN, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  ink(doc, PDF.muted);
  const contact = [addressOf(org), org?.owner_phone && `Tél. ${org.owner_phone}`, org?.scanlinkpay_number && `N° ${org.scanlinkpay_number}`].filter(Boolean).join('   ·   ');
  if (contact) { y += 4.6; doc.text(contact, MARGIN, y); }

  // Station / period / currency chips on the right.
  const right: string[] = [opts.meta.stationName && `Station : ${opts.meta.stationName}`, opts.period && `Période : ${opts.period}`, opts.currency && `Caisse en ${opts.currency}`].filter(Boolean) as string[];
  ink(doc, PDF.text);
  doc.setFontSize(8.5);
  right.forEach((line, i) => doc.text(line, w - MARGIN, 36 + i * 4.6, { align: 'right' }));

  y = Math.max(y, 36 + right.length * 4.6) + 4;
  stroke(doc, PDF.line);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, w - MARGIN, y);
  ink(doc, PDF.text);
  return y + 6;
}

/** A section title with a short blue bar. */
export function sectionTitle(doc: jsPDF, y: number, text: string): number {
  if (y > PAGE_BOTTOM - 25) { doc.addPage(); y = CONTENT_TOP; }
  fill(doc, PDF.blue);
  doc.rect(MARGIN, y - 3.6, 1.6, 5, 'F');
  ink(doc, PDF.navy);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(text, MARGIN + 4, y);
  doc.setFont('helvetica', 'normal');
  ink(doc, PDF.text);
  return y + 5;
}

export interface KpiCard { label: string; value: string; tone?: 'in' | 'out' | 'warn' | 'main' }

/** Key figures as cards in one row (up to 5). */
export function drawKpis(doc: jsPDF, y: number, cards: KpiCard[]): number {
  const w = doc.internal.pageSize.getWidth() - MARGIN * 2;
  const gap = 3;
  const cw = (w - gap * (cards.length - 1)) / cards.length;
  cards.forEach((c, i) => {
    const x = MARGIN + i * (cw + gap);
    const main = c.tone === 'main';
    fill(doc, main ? PDF.navy : PDF.paleBlue);
    doc.roundedRect(x, y, cw, 17, 2, 2, 'F');
    if (!main) { stroke(doc, PDF.line); doc.setLineWidth(0.25); doc.roundedRect(x, y, cw, 17, 2, 2, 'S'); }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    ink(doc, main ? PDF.sky : PDF.muted);
    doc.text(c.label.toUpperCase(), x + 3, y + 5.2, { maxWidth: cw - 5 });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(cards.length > 4 ? 9 : 10.5);
    ink(doc, main ? PDF.white : c.tone === 'in' ? PDF.green : c.tone === 'out' ? PDF.red : c.tone === 'warn' ? PDF.amber : PDF.navy);
    doc.text(c.value, x + 3, y + 12.6, { maxWidth: cw - 5 });
  });
  doc.setFont('helvetica', 'normal');
  ink(doc, PDF.text);
  return y + 17 + 6;
}

export interface Col { title: string; width: number; align?: 'left' | 'right' | 'center' }
/** A cell is plain text, or text with a colour / weight. */
export type Cell = string | { text: string; color?: RGB; bold?: boolean };
export interface Row { cells: Cell[]; kind?: 'normal' | 'total' | 'sub' }

/**
 * A structured table: navy header (repeated on every new page), zebra rows, wrapped labels, right-aligned figures
 * and an optional bold total row. Widths are in mm and are scaled to the page width.
 */
export function drawTable(doc: jsPDF, y: number, columns: Col[], rows: Row[], opts: { emptyText?: string } = {}): number {
  const pageW = doc.internal.pageSize.getWidth() - MARGIN * 2;
  const sum = columns.reduce((s, c) => s + c.width, 0);
  const widths = columns.map((c) => (c.width / sum) * pageW);
  const xs = widths.map((_, i) => MARGIN + widths.slice(0, i).reduce((s, v) => s + v, 0));
  const pad = 2;
  const align = (i: number) => columns[i].align || 'left';
  const textX = (i: number) => (align(i) === 'right' ? xs[i] + widths[i] - pad : align(i) === 'center' ? xs[i] + widths[i] / 2 : xs[i] + pad);

  const header = (at: number) => {
    fill(doc, PDF.navy);
    doc.rect(MARGIN, at, pageW, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    ink(doc, PDF.white);
    columns.forEach((c, i) => doc.text(c.title, textX(i), at + 4.7, { align: align(i), maxWidth: widths[i] - pad * 2 }));
    return at + 7;
  };

  if (y > PAGE_BOTTOM - 20) { doc.addPage(); y = CONTENT_TOP; }
  y = header(y);
  if (!rows.length) {
    ink(doc, PDF.muted);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.5);
    doc.text(opts.emptyText || 'Aucune donnée sur cette période.', MARGIN + pad, y + 5.5);
    doc.setFont('helvetica', 'normal');
    ink(doc, PDF.text);
    return y + 11;
  }

  let zebra = false;
  for (const row of rows) {
    const total = row.kind === 'total';
    const sub = row.kind === 'sub';
    doc.setFont('helvetica', total || sub ? 'bold' : 'normal');
    doc.setFontSize(8.3);
    const lines = row.cells.map((cell, i) => {
      const text = typeof cell === 'string' ? cell : cell.text;
      return doc.splitTextToSize(text || '', widths[i] - pad * 2) as string[];
    });
    const h = Math.max(...lines.map((l) => l.length)) * 4 + 2.6;
    if (y + h > PAGE_BOTTOM) { doc.addPage(); y = header(CONTENT_TOP); zebra = false; }
    if (total) fill(doc, PDF.line);
    else if (sub) fill(doc, [233, 237, 255] as RGB);
    else if (zebra) fill(doc, PDF.paleBlue);
    if (total || sub || zebra) doc.rect(MARGIN, y, pageW, h, 'F');
    row.cells.forEach((cell, i) => {
      const color = typeof cell === 'string' ? undefined : cell.color;
      const bold = typeof cell === 'string' ? false : cell.bold;
      doc.setFont('helvetica', total || sub || bold ? 'bold' : 'normal');
      ink(doc, color || (total || sub ? PDF.navy : PDF.text));
      lines[i].forEach((ln, k) => doc.text(ln, textX(i), y + 4.6 + k * 4, { align: align(i) }));
    });
    if (total) { stroke(doc, PDF.navy); doc.setLineWidth(0.4); doc.line(MARGIN, y, MARGIN + pageW, y); }
    y += h;
    zebra = !zebra;
  }
  stroke(doc, PDF.line);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, MARGIN + pageW, y);
  doc.setFont('helvetica', 'normal');
  ink(doc, PDF.text);
  return y + 6;
}

/** Two signature boxes: the station's cashier (printed names + a space to sign) and the manager's visa. */
export function drawSignatures(doc: jsPDF, y: number, opts: { cashier?: string; manager?: string }): number {
  const w = doc.internal.pageSize.getWidth() - MARGIN * 2;
  const boxH = 44;
  if (y + boxH + 8 > PAGE_BOTTOM) { doc.addPage(); y = CONTENT_TOP; }
  y = sectionTitle(doc, y + 2, 'Validation');
  const bw = (w - 6) / 2;
  const boxes = [
    { x: MARGIN, role: 'Le caissier', name: opts.cashier || '…………………………………………', note: 'Nom et signature' },
    { x: MARGIN + bw + 6, role: 'Le gérant / le patron', name: opts.manager || '…………………………………………', note: 'Visa' },
  ];
  for (const b of boxes) {
    stroke(doc, PDF.line);
    doc.setLineWidth(0.4);
    doc.roundedRect(b.x, y, bw, boxH, 2, 2, 'S');
    fill(doc, PDF.paleBlue);
    doc.roundedRect(b.x, y, bw, 7, 2, 2, 'F');
    doc.rect(b.x, y + 4, bw, 3, 'F');
    ink(doc, PDF.navy);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(b.role.toUpperCase(), b.x + 3, y + 4.8);
    ink(doc, PDF.text);
    doc.setFontSize(10);
    doc.text(b.name, b.x + 3, y + 13, { maxWidth: bw - 6 });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    ink(doc, PDF.muted);
    doc.text('Date :', b.x + 3, y + 20);
    stroke(doc, PDF.muted);
    doc.setLineWidth(0.25);
    doc.line(b.x + 14, y + 20.4, b.x + 55, y + 20.4);
    doc.text(`${b.note} :`, b.x + 3, y + 27);
    doc.line(b.x + 3, y + 39, b.x + bw - 4, y + 39);
  }
  ink(doc, PDF.text);
  return y + boxH + 4;
}

/** Page footer on every page: product, business, confidentiality note and page numbers. Call once, at the end. */
export function drawFooters(doc: jsPDF, name?: string, skipFirst = false) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  const pages = doc.getNumberOfPages();
  for (let p = skipFirst ? 2 : 1; p <= pages; p++) {
    doc.setPage(p);
    stroke(doc, PDF.line);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, h - 13, w - MARGIN, h - 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    ink(doc, PDF.muted);
    doc.text(`Document généré par ScanLinkPay${name ? ` · ${clean(name)}` : ''}`, MARGIN, h - 8.8);
    doc.text('Document comptable : il ne modifie aucun solde.', MARGIN, h - 4.6);
    doc.text(`Page ${p} / ${pages}`, w - MARGIN, h - 8.8, { align: 'right' });
  }
}
