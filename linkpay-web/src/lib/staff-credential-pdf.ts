import jsPDF from 'jspdf';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import logoSrc from '@/assets/logo.png';

interface StaffCredentialData {
  nom: string;
  postnom?: string | null;
  prenom: string;
  email: string;
  temp_password: string;
  role_name?: string;
  orgName: string;
}

// Same indigo as expense-pdf.ts (matches --primary in index.css).
const PRIMARY: [number, number, number] = [80, 72, 229];
const PRIMARY_LIGHT: [number, number, number] = [237, 236, 253];
const TEXT_DARK: [number, number, number] = [30, 30, 40];
const TEXT_MUTED: [number, number, number] = [110, 110, 130];
const BORDER: [number, number, number] = [225, 224, 245];

function buildStaffCredentialPdf(staff: StaffCredentialData): jsPDF {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 18;
  let y = 0;

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
  doc.text(`Accès collaborateur — ${staff.orgName}`, marginX + 20, 23);

  y = headerHeight + 16;

  const fullName = [staff.prenom, staff.postnom, staff.nom].filter(Boolean).join(' ');
  doc.setTextColor(...TEXT_DARK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(fullName, marginX, y);
  y += 7;
  if (staff.role_name) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(...TEXT_MUTED);
    doc.text(staff.role_name, marginX, y);
    y += 10;
  } else {
    y += 4;
  }

  const boxHeight = 46;
  doc.setFillColor(...PRIMARY_LIGHT);
  doc.roundedRect(marginX, y, pageWidth - marginX * 2, boxHeight, 3, 3, 'F');
  let ty = y + 12;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...PRIMARY);
  doc.text('IDENTIFIANT (EMAIL)', marginX + 8, ty);
  ty += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  doc.setTextColor(...TEXT_DARK);
  doc.text(staff.email, marginX + 8, ty);
  ty += 12;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...PRIMARY);
  doc.text('MOT DE PASSE TEMPORAIRE', marginX + 8, ty);
  ty += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  doc.setTextColor(...TEXT_DARK);
  doc.text(staff.temp_password, marginX + 8, ty);

  y += boxHeight + 10;
  doc.setDrawColor(...BORDER);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...TEXT_MUTED);
  const notice = 'Ce mot de passe est valable une seule fois. À la première connexion, un nouveau mot de passe personnel devra être défini — après quoi ce document ne sera plus utilisable.';
  doc.text(notice, marginX, y, { maxWidth: pageWidth - marginX * 2 });

  return doc;
}

/**
 * Same delivery mechanism as expense-pdf.ts's downloadExpenseDayPdf — native
 * share sheet on Android/iOS, plain download on web/PWA.
 */
export async function downloadStaffCredentialPdf(staff: StaffCredentialData): Promise<void> {
  const doc = buildStaffCredentialPdf(staff);
  const filename = `acces-${staff.prenom}-${staff.nom}.pdf`.toLowerCase().replace(/\s+/g, '-');

  if (Capacitor.isNativePlatform()) {
    const base64 = doc.output('datauristring').split(',')[1];
    const { uri } = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
    await Share.share({ title: filename, files: [uri], dialogTitle: 'Enregistrer le PDF' });
    return;
  }

  doc.save(filename);
}
