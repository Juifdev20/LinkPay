import QRCode from 'qrcode';
import type { ReceiptLine } from './types';
import { layout, pad } from './escpos';

/**
 * Ticket → image PNG d'un seul tenant (80 mm, 48 colonnes), quelle que soit sa longueur. Pour joindre une facture ou un
 * rapport à un dossier (homologation DGI) sans capture d'écran défilante. Ce n'est PAS une impression : le compteur
 * d'impressions (original / DUPLICATA) ne bouge pas.
 */
const COLONNES = 48;
const ECHELLE = 2; // 2 pixels écran par pixel de conception : texte net une fois collé dans un document
const TAILLE_POLICE = 15;
const HAUTEUR_LIGNE = 20;
const MARGE = 18;
const TAILLE_QR = 200;
const POLICE = '"Courier New", Consolas, "Liberation Mono", monospace';

export async function ticketEnImage(lines: ReceiptLine[], colonnes = COLONNES): Promise<Blob> {
  const rows = layout(lines, colonnes);
  const mesure = document.createElement('canvas').getContext('2d')!;
  mesure.font = `${TAILLE_POLICE}px ${POLICE}`;
  const largeurCar = mesure.measureText('M').width;
  const largeur = Math.ceil(colonnes * largeurCar + MARGE * 2);

  const hauteurs = rows.map((r) => (r.qr ? TAILLE_QR + 16 : r.tall ? Math.round(HAUTEUR_LIGNE * 1.7) : HAUTEUR_LIGNE));
  const hauteur = MARGE * 2 + hauteurs.reduce((s, h) => s + h, 0);

  const canvas = document.createElement('canvas');
  canvas.width = largeur * ECHELLE;
  canvas.height = hauteur * ECHELLE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(ECHELLE, ECHELLE);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, largeur, hauteur);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'alphabetic';

  let y = MARGE;
  rows.forEach((r, i) => {
    const h = hauteurs[i];
    if (r.qr) {
      const qr = QRCode.create(r.qr, { errorCorrectionLevel: 'M' });
      const n = qr.modules.size;
      const marge = 2;
      const module = TAILLE_QR / (n + marge * 2);
      const x0 = (largeur - TAILLE_QR) / 2;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x0, y + 8, TAILLE_QR, TAILLE_QR);
      ctx.fillStyle = '#000000';
      for (let yy = 0; yy < n; yy++) {
        for (let xx = 0; xx < n; xx++) {
          if (qr.modules.get(xx, yy)) ctx.fillRect(x0 + (xx + marge) * module, y + 8 + (yy + marge) * module, Math.ceil(module), Math.ceil(module));
        }
      }
    } else {
      const texte = pad(r, colonnes);
      ctx.font = `${r.bold ? 'bold ' : ''}${TAILLE_POLICE}px ${POLICE}`;
      ctx.save();
      // « tall » = double hauteur, comme sur le ticket thermique.
      const etire = r.tall ? 1.6 : 1;
      ctx.translate(MARGE, y + h - 5 * etire);
      ctx.scale(1, etire);
      ctx.fillText(texte, 0, 0);
      ctx.restore();
    }
    y += h;
  });

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image impossible à produire'))), 'image/png'));
}

/** Enregistre l'image sur l'appareil (téléchargement du navigateur). */
export async function telechargerTicket(lines: ReceiptLine[], nom: string): Promise<void> {
  const blob = await ticketEnImage(lines);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${nom.replace(/[^\w.-]+/g, '-')}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
