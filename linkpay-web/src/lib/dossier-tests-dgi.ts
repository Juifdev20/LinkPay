import { jsPDF } from 'jspdf';
import { buildFactureNormalisee, type VueFactureNormalisee } from './printing/build-facture-normalisee';
import { buildRapportFiscal, titreRapport, type VueRapportFiscal } from './printing/build-rapport-fiscal';
import { ticketEnImage, ticketEnImageDetail } from './printing/receipt-image';

/**
 * « Dossier de preuves » de l'homologation DGI : un seul PDF qui reprend le document « Cas de test SFE » — une page par
 * cas, avec la facture normalisée en TTC et en HT côte à côte telle que ScanLinkPay l'imprime (code QR compris) —, puis
 * les rapports X, Z et A (R01 à R03). Il reste à vérifier chaque facture sur le site de la DGI.
 */
export interface CasDossier {
  num: number;
  titre: string;
  type_libelle: string;
  client: string;
  articles: string;
  a_verifier: string;
  hors_perimetre: string | null;
}
export interface ResultatDossier {
  num: number;
  mode: 'ttc' | 'ht';
  etat: string;
  facture: { id: string; rn: string; code_def_dgi: string | null; total_cents: number | null } | null;
}

export interface OptionsDossier {
  orgId: string;
  campagne: string;
  nif: string;
  cas: CasDossier[];
  resultats: ResultatDossier[];
  /** GET d'une URL de l'API → données. */
  charger: (url: string) => Promise<any>;
  onProgress?: (fait: number, total: number) => void;
}

const A4 = { l: 210, h: 297 };
const MARGE = 12;

/** jsPDF (polices standard) : on garde des caractères simples. */
const t = (s: string) => String(s ?? '').replace(/[’‘]/g, "'").replace(/[—–]/g, '-').replace(/…/g, '...').replace(/[  ]/g, ' ');

const enDataUrl = (blob: Blob) =>
  new Promise<string>((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => ko(r.error);
    r.readAsDataURL(blob);
  });

/** Découpe une image très haute en tranches de la hauteur d'une page (rapports), sans couper une ligne en deux. */
async function tranches(blob: Blob, ratioMax: number, bornes: number[] = []): Promise<{ url: string; l: number; h: number }[]> {
  const img = await createImageBitmap(blob);
  const hTranche = Math.round(img.width * ratioMax);
  if (img.height <= hTranche) return [{ url: await enDataUrl(blob), l: img.width, h: img.height }];
  const sortie: { url: string; l: number; h: number }[] = [];
  let y = 0;
  while (y < img.height) {
    let fin = Math.min(y + hTranche, img.height);
    if (fin < img.height) {
      // la dernière fin de ligne qui tient dans la page
      const b = [...bornes].reverse().find((v) => v > y + hTranche * 0.5 && v <= fin);
      if (b) fin = b;
    }
    // Un petit reste (marge blanche en bas du ticket) ne mérite pas sa propre page : on le garde avec celle-ci.
    if (img.height - fin < hTranche * 0.1) fin = img.height;
    const h = fin - y;
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, h);
    ctx.drawImage(img, 0, y, img.width, h, 0, 0, img.width, h);
    sortie.push({ url: c.toDataURL('image/png'), l: img.width, h });
    y = fin;
  }
  return sortie;
}

/** Place une image dans une boîte sans la déformer (centrée en largeur). */
function placer(doc: jsPDF, url: string, l: number, h: number, x: number, y: number, boiteL: number, boiteH: number) {
  const ratio = h / l;
  let w = boiteL;
  let hh = w * ratio;
  if (hh > boiteH) {
    hh = boiteH;
    w = hh / ratio;
  }
  doc.addImage(url, 'PNG', x + (boiteL - w) / 2, y, w, hh, undefined, 'FAST');
}

async function enParallele<T, R>(items: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await f(items[k]);
      }
    }),
  );
  return out;
}

export async function genererDossierTestsDgi(o: OptionsDossier): Promise<Blob> {
  const base = `/organizations/${o.orgId}/facture-normalisee`;
  const parCle = new Map(o.resultats.map((r) => [`${r.num}:${r.mode}`, r]));
  const reussies = o.resultats.filter((r) => r.etat === 'reussi' && r.facture);
  const total = reussies.length + 3;
  let fait = 0;
  const avance = () => o.onProgress?.(++fait, total);

  // 1) Les images de toutes les factures réussies (quelques-unes à la fois).
  const images = new Map<string, { url: string; l: number; h: number }>();
  let vendeur = '';
  let nim = '';
  await enParallele(reussies, 4, async (r) => {
    const vue = (await o.charger(`${base}/factures/${r.facture!.id}`)) as VueFactureNormalisee;
    vendeur = vendeur || vue.vendeur?.denomination || '';
    nim = nim || vue.facture?.nim || '';
    // Le dossier montre la facture comme à l'émission (original), même si elle a déjà été réimprimée.
    const blob = await ticketEnImage(buildFactureNormalisee({ ...vue, facture: { ...vue.facture, duplicata: false } }));
    const [img] = await tranches(blob, 99);
    images.set(`${r.num}:${r.mode}`, img);
    avance();
  });

  // 2) Les derniers rapports X, Z et A.
  const rapports: { code: string; type: 'X' | 'Z' | 'A'; vue: VueRapportFiscal | null; pages: { url: string; l: number; h: number }[] }[] = [];
  for (const [code, type] of [['R01', 'X'], ['R02', 'Z'], ['R03', 'A']] as const) {
    let vue: VueRapportFiscal | null = null;
    let pages: { url: string; l: number; h: number }[] = [];
    try {
      // Le dernier rapport qui MONTRE quelque chose : un X fait juste après un Z, ou un A refait sans nouvelle vente,
      // est vide et ne prouve rien. Le Z, lui, est toujours le dernier.
      const liste = await o.charger(`${base}/rapports?type=${type}&limit=30`);
      const plein = (r: any) => (type === 'X' ? (r?.totaux?.factures ?? 0) > 0 : type === 'A' ? (r?.totaux?.articles ?? 0) > 0 : true);
      const id = (liste?.rapports ?? []).find(plein)?.id ?? liste?.rapports?.[0]?.id;
      if (id) {
        vue = (await o.charger(`${base}/rapports/${id}`)) as VueRapportFiscal;
        const { blob, bornes } = await ticketEnImageDetail(buildRapportFiscal({ ...vue, duplicata: false }));
        pages = await tranches(blob, 1.3, bornes);
      }
    } catch {
      vue = null;
    }
    rapports.push({ code, type, vue, pages });
    avance();
  }

  // 3) Le PDF.
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const date = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' });
  const pied = (n: number) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(t(`ScanLinkPay - Dossier de preuves des tests DGI - campagne ${o.campagne} - ${date}`), MARGE, A4.h - 6);
    doc.text(`${n}`, A4.l - MARGE, A4.h - 6, { align: 'right' });
    doc.setTextColor(0);
  };

  // Page de garde + récapitulatif
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(t("Dossier de preuves - tests d'homologation SFE"), MARGE, 22);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  const infos = [
    `Système de facturation d'entreprise (SFE) : ScanLinkPay`,
    `Contribuable : ${vendeur || '-'}   NIF : ${o.nif}`,
    `e-MCF de test : ${nim || '-'}   Campagne : ${o.campagne}`,
    `Document généré le ${date}`,
  ];
  // Une ligne trop longue (raison sociale complète) passe à la suivante au lieu de sortir de la page.
  let yInfo = 32;
  for (const l of infos) {
    const morceaux = doc.splitTextToSize(t(l), A4.l - MARGE * 2) as string[];
    doc.text(morceaux, MARGE, yInfo);
    yInfo += morceaux.length * 5.2 + 1;
  }
  const reussisTtc = reussies.filter((r) => r.mode === 'ttc').length;
  const reussisHt = reussies.filter((r) => r.mode === 'ht').length;
  const perimetre = o.cas.filter((c) => !c.hors_perimetre).length;
  doc.setFont('helvetica', 'bold');
  doc.text(t(`Cas du périmètre réussis : TTC ${reussisTtc} / ${perimetre}   -   HT ${reussisHt} / ${perimetre}`), MARGE, yInfo + 8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  let y = yInfo + 18;
  doc.setFont('helvetica', 'bold');
  doc.text('Cas', MARGE, y);
  doc.text('Description', MARGE + 12, y);
  doc.text('TTC', 150, y);
  doc.text('HT', 175, y);
  doc.setFont('helvetica', 'normal');
  for (const c of o.cas) {
    y += 5.6;
    const s = (m: 'ttc' | 'ht') => (c.hors_perimetre ? '-' : parCle.get(`${c.num}:${m}`)?.etat === 'reussi' ? 'Réussi' : 'À faire');
    doc.text(String(c.num), MARGE, y);
    doc.text(t(c.titre).slice(0, 78), MARGE + 12, y);
    doc.text(s('ttc'), 150, y);
    doc.text(s('ht'), 175, y);
  }
  doc.setFontSize(8);
  doc.text(t("Chaque facture ci-dessous est celle générée par le SFE ; elle doit être vérifiée sur https://developper.dgirdc.cd/sygdef/verification"), MARGE, y + 10);
  pied(1);

  // Une page par cas
  let n = 1;
  for (const c of o.cas) {
    doc.addPage();
    n += 1;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(t(`Test #${c.num} - ${c.titre}`), MARGE, 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    const fiche = [`Type : ${c.type_libelle}`, `Articles : ${c.articles}`, `Type du client : ${c.client}`, `À vérifier : ${c.a_verifier}`];
    fiche.forEach((l, i) => doc.text(t(l), MARGE, 23 + i * 5));
    const top = 46;
    const boite = { l: (A4.l - MARGE * 2 - 8) / 2, h: A4.h - top - 14 };
    if (c.hors_perimetre) {
      doc.setFontSize(12);
      doc.text(t(`${c.hors_perimetre} à l'homologation : cas hors périmètre (non demandé).`), MARGE, top + 20);
    } else {
      (['ttc', 'ht'] as const).forEach((m, i) => {
        const x = MARGE + i * (boite.l + 8);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        const r = parCle.get(`${c.num}:${m}`);
        doc.text(t(`Mode ${m.toUpperCase()}${r?.facture ? ` - facture ${r.facture.rn}` : ''}`), x, top - 2);
        const img = images.get(`${c.num}:${m}`);
        if (img) placer(doc, img.url, img.l, img.h, x, top + 1, boite.l, boite.h);
        else {
          doc.setFont('helvetica', 'normal');
          doc.text(t('Non fait (ou non réussi)'), x, top + 12);
        }
      });
    }
    pied(n);
  }

  // Rapports
  for (const r of rapports) {
    doc.addPage();
    n += 1;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(t(`Test #${r.code} - ${r.vue ? titreRapport(r.vue) : `Rapport ${r.type}`}`), MARGE, 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(t('Produire un rapport ' + r.type + ' affichant tous les éléments du rapport'), MARGE, 23);
    if (!r.pages.length) {
      doc.setFontSize(12);
      doc.text(t(`Rapport ${r.type} non fait : faites-le dans l'onglet Rapports, puis régénérez ce dossier.`), MARGE, 40);
      pied(n);
      continue;
    }
    r.pages.forEach((p, k) => {
      if (k > 0) {
        doc.addPage();
        n += 1;
        doc.setFontSize(9);
        doc.text(t(`Test #${r.code} (suite ${k + 1}/${r.pages.length})`), MARGE, 12);
      }
      const hauteur = A4.h - (k === 0 ? 30 : 20) - 12;
      placer(doc, p.url, p.l, p.h, MARGE, k === 0 ? 28 : 16, A4.l - MARGE * 2, hauteur);
      pied(n);
    });
  }

  return doc.output('blob');
}

export function telechargerBlob(blob: Blob, nom: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15_000);
}
