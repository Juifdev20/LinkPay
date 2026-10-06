import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import logoSrc from '@/assets/logo.png';
import { buildInvoiceModel, type InvoiceModel, type InvoiceOrg, type InvoiceSale } from '@/lib/sale-invoice';

// Same palette as staff-credential-pdf.ts (matches --primary in index.css).
const PRIMARY: [number, number, number] = [80, 72, 229];
const PRIMARY_LIGHT: [number, number, number] = [237, 236, 253];
const TEXT_DARK: [number, number, number] = [30, 30, 40];
const TEXT_MUTED: [number, number, number] = [110, 110, 130];
const BORDER: [number, number, number] = [225, 224, 245];

// The A4 sheet is divided in three bands of 99 mm. One invoice fills one band,
// so the same sheet can be reused for three invoices (the printed invoice is
// never duplicated on the sheet). Faint guides mark where to cut.
const PAGE_H = 297;
const BAND_H = PAGE_H / 3;
const MARGIN_X = 12;

function drawInvoice(doc: jsPDF, m: InvoiceModel, saleQr: string | null, top: number) {
  const w = doc.internal.pageSize.getWidth();
  const left = MARGIN_X;
  const right = w - MARGIN_X;
  const bottom = top + BAND_H;

  // Header band.
  doc.setFillColor(...PRIMARY);
  doc.rect(0, top, w, 13, 'F');
  doc.addImage(logoSrc, 'PNG', left, top + 2.2, 8.5, 8.5);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('FACTURE', left + 11, top + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text(m.reference, right, top + 5, { align: 'right' });
  doc.text(m.dateTime, right, top + 9.5, { align: 'right' });

  // Business identity.
  let y = top + 17;
  doc.setTextColor(...TEXT_DARK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(m.businessName, left, y);
  y += 3.6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...TEXT_MUTED);
  const contact = [m.address, m.phone ? `Tél. ${m.phone}` : null].filter(Boolean).join('  ·  ');
  if (contact) {
    doc.text(contact, left, y);
    y += 3.2;
  }
  if (m.slogan) {
    doc.setFont('helvetica', 'italic');
    doc.text(`« ${m.slogan} »`, left, y);
    y += 3.2;
  }

  // Table header.
  y += 1;
  doc.setFillColor(...PRIMARY_LIGHT);
  doc.rect(left, y, right - left, 5.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...PRIMARY);
  doc.text('ARTICLE ET CARACTÉRISTIQUES', left + 2, y + 3.8);
  doc.text('QTÉ', right - 58, y + 3.8, { align: 'right' });
  doc.text('PRIX UNIT.', right - 30, y + 3.8, { align: 'right' });
  doc.text('TOTAL', right - 2, y + 3.8, { align: 'right' });
  y += 5.5;

  // Lines: product name, then one line of characteristics per product.
  for (const line of m.lines) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_DARK);
    doc.text(line.title, left + 2, y + 3.6, { maxWidth: 105 });
    doc.text(String(line.quantity), right - 58, y + 3.6, { align: 'right' });
    doc.text(line.unitPrice, right - 30, y + 3.6, { align: 'right' });
    doc.text(line.total, right - 2, y + 3.6, { align: 'right' });
    y += 4.4;
    if (line.specs.length) {
      const specText = line.specs.map((s) => `${s.label} : ${s.value}`).join('  ·  ');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.6);
      doc.setTextColor(...TEXT_MUTED);
      const wrapped = doc.splitTextToSize(specText, right - left - 4) as string[];
      doc.text(wrapped, left + 2, y + 2.4);
      y += wrapped.length * 2.9 + 0.8;
    }
    doc.setDrawColor(...BORDER);
    doc.line(left, y, right, y);
    y += 1.6;
  }

  // Total.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...TEXT_DARK);
  doc.text('Total à payer', right - 58, y + 4, { align: 'right' });
  doc.setTextColor(...PRIMARY);
  doc.text(m.total, right - 2, y + 4, { align: 'right' });
  y += 7.5;

  // Payment block: this sale's QR and the business's ScanLinkPay number.
  const footerY = bottom - 4.5;
  const blockH = Math.max(15, footerY - 3 - y);
  doc.setFillColor(...PRIMARY_LIGHT);
  doc.roundedRect(left, y, right - left, blockH, 2, 2, 'F');
  const qrSize = Math.min(18, blockH - 4);
  const qrY = y + (blockH - qrSize) / 2;
  if (saleQr) doc.addImage(saleQr, 'PNG', left + 3, qrY, qrSize, qrSize);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(...PRIMARY);
  doc.text('PAYER CETTE FACTURE', left + qrSize + 7, qrY + 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.3);
  doc.setTextColor(...TEXT_MUTED);
  doc.text('Scannez avec ScanLinkPay', left + qrSize + 7, qrY + 8);

  const numX = right - 3;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.3);
  doc.setTextColor(...TEXT_MUTED);
  doc.text('Numéro ScanLinkPay', numX, qrY + 4, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...TEXT_DARK);
  doc.text(m.scanlinkpayNumber || '—', numX, qrY + 10, { align: 'right' });

  // Footer message (receipt terms).
  if (m.footerMessage) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(6.3);
    doc.setTextColor(...TEXT_MUTED);
    doc.text(m.footerMessage, w / 2, footerY + 2, { align: 'center', maxWidth: right - left });
  }
}

/** One invoice in the first third of an A4 sheet, with cut guides. */
export async function buildSaleInvoicePdf(org: InvoiceOrg, sale: InvoiceSale): Promise<jsPDF> {
  const model = buildInvoiceModel(org, sale);
  const doc = new jsPDF({ format: 'a4', unit: 'mm' });

  const saleQr = model.salePaymentUrl
    ? await QRCode.toDataURL(model.salePaymentUrl, { width: 240, margin: 1, color: { dark: '#0F172A', light: '#FFFFFF' } })
    : null;

  drawInvoice(doc, model, saleQr, 0);

  const w = doc.internal.pageSize.getWidth();
  doc.setDrawColor(...BORDER);
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.line(0, BAND_H, w, BAND_H);
  doc.line(0, BAND_H * 2, w, BAND_H * 2);
  doc.setLineDashPattern([], 0);

  return doc;
}

/**
 * Same delivery as staff-credential-pdf.ts: native share sheet on
 * Android/iOS (where the user can send it to a printer), plain download on web.
 */
export async function downloadSaleInvoicePdf(org: InvoiceOrg, sale: InvoiceSale): Promise<void> {
  const doc = await buildSaleInvoicePdf(org, sale);
  const filename = `facture-${sale.reference}.pdf`.toLowerCase();

  if (Capacitor.isNativePlatform()) {
    const base64 = doc.output('datauristring').split(',')[1];
    const { uri } = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
    await Share.share({ title: filename, files: [uri], dialogTitle: 'Partager la facture' });
    return;
  }

  doc.save(filename);
}
