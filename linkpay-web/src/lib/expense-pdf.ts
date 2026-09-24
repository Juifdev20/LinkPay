import jsPDF from 'jspdf';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import logoSrc from '@/assets/logo.png';
import { formatDate } from './utils';

interface ExpenseEntry {
  amount_cents: number;
  currency: 'CDF' | 'USD';
  description?: string | null;
  created_at: string;
}

interface ExpenseDayPdfData {
  expense_date: string;
  entries: ExpenseEntry[];
  totals: { CDF: number; USD: number };
}

// Same indigo as --primary in index.css (hsl(243 75% 59%)), as plain RGB —
// jsPDF's standard fonts/fills work in RGB, not CSS custom properties.
const PRIMARY: [number, number, number] = [80, 72, 229];
const PRIMARY_LIGHT: [number, number, number] = [237, 236, 253];
const TEXT_DARK: [number, number, number] = [30, 30, 40];
const TEXT_MUTED: [number, number, number] = [110, 110, 130];
const BORDER: [number, number, number] = [225, 224, 245];

/**
 * Plain-ASCII money formatting for the PDF specifically — jsPDF's standard
 * fonts only support WinAnsi encoding, not the narrow no-break space
 * (U+202F) Intl.NumberFormat('fr-CD', ...) uses as a thousands separator
 * (formatCurrency(), used everywhere in the UI, renders fine in a browser
 * but turns into a garbled "/" here). Builds the same "5 000,00 CDF" shape
 * by hand with an ordinary space instead.
 */
function pdfMoney(cents: number, currency: 'CDF' | 'USD'): string {
  const [intPart, decPart] = (cents / 100).toFixed(2).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${grouped},${decPart} ${currency}`;
}

function buildExpenseDayPdf(day: ExpenseDayPdfData): jsPDF {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 18;
  let y = 0;

  // ---- Header band ----
  const headerHeight = 32;
  doc.setFillColor(...PRIMARY);
  doc.rect(0, 0, pageWidth, headerHeight, 'F');
  doc.addImage(logoSrc, 'PNG', marginX, 8, 16, 16);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('ScanLinkPay', marginX + 20, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Rapport de dépenses journalières', marginX + 20, 23);

  y = headerHeight + 14;

  // ---- Date ----
  doc.setTextColor(...TEXT_DARK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(formatDate(day.expense_date), marginX, y);
  y += 10;

  // ---- Table header ----
  const col2 = pageWidth - marginX - 70;
  const col3 = pageWidth - marginX - 38;
  const rowHeight = 9;

  const drawTableHeader = () => {
    doc.setFillColor(...PRIMARY_LIGHT);
    doc.rect(marginX, y - 6, pageWidth - marginX * 2, rowHeight, 'F');
    doc.setTextColor(...PRIMARY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('DESCRIPTION', marginX + 3, y);
    doc.text('DEVISE', col2, y);
    doc.text('MONTANT', col3, y);
    y += rowHeight;
  };

  drawTableHeader();

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  day.entries.forEach((entry, i) => {
    if (y > pageHeight - 40) {
      doc.addPage();
      y = 24;
      drawTableHeader();
    }
    if (i % 2 === 1) {
      doc.setFillColor(248, 248, 252);
      doc.rect(marginX, y - 6, pageWidth - marginX * 2, rowHeight, 'F');
    }
    doc.setTextColor(...TEXT_DARK);
    doc.text(entry.description || '—', marginX + 3, y, { maxWidth: col2 - marginX - 6 });
    doc.setTextColor(...TEXT_MUTED);
    doc.text(entry.currency, col2, y);
    doc.setTextColor(...TEXT_DARK);
    doc.text(pdfMoney(entry.amount_cents, entry.currency), col3, y);
    y += rowHeight;
  });

  doc.setDrawColor(...BORDER);
  doc.line(marginX, y - 4, pageWidth - marginX, y - 4);
  y += 8;

  // ---- Total box — never merges CDF and USD, one line each ----
  const hasCDF = day.totals.CDF > 0;
  const hasUSD = day.totals.USD > 0;
  const totalLines = hasCDF || hasUSD ? Number(hasCDF) + Number(hasUSD) : 1;
  const boxHeight = 12 + totalLines * 8;

  doc.setFillColor(...PRIMARY_LIGHT);
  doc.roundedRect(marginX, y, pageWidth - marginX * 2, boxHeight, 2, 2, 'F');
  let ty = y + 10;
  doc.setTextColor(...PRIMARY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('TOTAL', marginX + 6, ty);
  ty += 8;
  doc.setFontSize(13);
  if (hasCDF) {
    doc.text(pdfMoney(day.totals.CDF, 'CDF'), marginX + 6, ty);
    ty += 8;
  }
  if (hasUSD) {
    doc.text(pdfMoney(day.totals.USD, 'USD'), marginX + 6, ty);
    ty += 8;
  }
  if (!hasCDF && !hasUSD) {
    doc.text(pdfMoney(0, 'CDF'), marginX + 6, ty);
  }

  // ---- Footer on every page ----
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(...BORDER);
    doc.line(marginX, pageHeight - 18, pageWidth - marginX, pageHeight - 18);

    if (p === pageCount) {
      doc.setTextColor(...PRIMARY);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text('Merci d’avoir utilisé ScanLinkPay', pageWidth / 2, pageHeight - 11, { align: 'center' });
    }

    doc.setTextColor(...TEXT_MUTED);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text("Document généré par l'application ScanLinkPay", pageWidth - marginX, pageHeight - 6, { align: 'right' });
  }

  return doc;
}

/**
 * Generates the PDF and hands it to the user — native share sheet (save/
 * send) on Android/iOS, a plain `<a download>` on web/PWA. Same mechanism
 * already proven for the QR PNG in wallet/Receive.tsx.
 */
export async function downloadExpenseDayPdf(day: ExpenseDayPdfData): Promise<void> {
  const doc = buildExpenseDayPdf(day);
  const filename = `depenses-${day.expense_date}.pdf`;

  if (Capacitor.isNativePlatform()) {
    const base64 = doc.output('datauristring').split(',')[1];
    const { uri } = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
    await Share.share({ title: filename, files: [uri], dialogTitle: 'Enregistrer le PDF' });
    return;
  }

  doc.save(filename);
}
