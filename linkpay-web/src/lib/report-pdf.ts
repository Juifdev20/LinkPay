import { jsPDF } from 'jspdf';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { formatCurrency } from '@/lib/utils';

/** formatCurrency uses narrow/no-break spaces the PDF base fonts can't draw. */
const money = (cents: number, currency: string) => formatCurrency(cents || 0, currency).replace(/[  ]/g, ' ');
const dateTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';

export const METHOD_LABELS: Record<string, string> = { cash: 'Espèces', scanlinkpay: 'ScanLinkPay', mixed: 'Mixte' };

/** Native share sheet on Android/iOS (where it can go to a printer or WhatsApp), plain download on the web. */
export async function deliverPdf(doc: jsPDF, filename: string, dialogTitle = 'Partager le rapport') {
  if (Capacitor.isNativePlatform()) {
    const base64 = doc.output('datauristring').split(',')[1];
    const { uri } = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
    await Share.share({ title: filename, files: [uri], dialogTitle });
    return;
  }
  doc.save(filename);
}

/** A small table writer: columns at fixed x, a new page when the bottom is reached. */
function table(doc: jsPDF, y: number, columns: { title: string; x: number }[], rows: string[][]): number {
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  columns.forEach((c) => doc.text(c.title, c.x, y));
  doc.setFont('helvetica', 'normal');
  y += 5;
  for (const row of rows) {
    if (y > 280) { doc.addPage(); y = 18; }
    row.forEach((cell, i) => doc.text(String(cell).slice(0, 48), columns[i].x, y));
    y += 5;
  }
  return y + 4;
}

function heading(doc: jsPDF, y: number, text: string): number {
  if (y > 265) { doc.addPage(); y = 18; }
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(text, 14, y);
  doc.setFont('helvetica', 'normal');
  return y + 6;
}

/** The station report (ReportsService.buildStationReport) as a printable PDF. */
export function buildStationReportPdf(report: any, meta: { orgName?: string; periodLabel: string }): jsPDF {
  const c = report.currency;
  const doc = new jsPDF();
  let y = 18;
  doc.setFontSize(16);
  doc.text(`Rapport — ${[meta.orgName, report.station?.name].filter(Boolean).join(' · ')}`, 14, y);
  y += 7;
  doc.setFontSize(10);
  doc.text(`Période : ${meta.periodLabel} · Devise : ${c} · Généré le ${new Date().toLocaleString('fr-FR')}`, 14, y);
  y += 10;

  y = heading(doc, y, 'Résumé');
  doc.setFontSize(10);
  const t = report.totals;
  for (const [k, v] of [
    ["Chiffre d'affaires", money(t.revenue_cents, c)],
    ['Tickets', String(t.tickets)],
    ['Panier moyen', money(t.avg_basket_cents, c)],
    ...Object.entries(t.by_method || {}).map(([m, v]) => [`  dont ${METHOD_LABELS[m] || m}`, money(v as number, c)]),
    ['Écart de caisse total', money(report.sessions_total.discrepancy_cents, c)],
    ['Articles annulés', `${report.voids_total.count} (${money(report.voids_total.amount_cents, c)})`],
  ]) { doc.text(`${k} : ${v}`, 14, y); y += 5.5; }
  y += 4;

  y = heading(doc, y, 'Par caissier');
  y = table(doc, y, [
    { title: 'Caissier', x: 14 }, { title: 'Tickets', x: 80 }, { title: 'Ventes', x: 100 }, { title: 'Espèces', x: 135 }, { title: 'Annul.', x: 165 }, { title: 'Écart', x: 180 },
  ], report.by_cashier.map((r: any) => [r.name, String(r.tickets), money(r.revenue_cents, c), money(r.cash_cents, c), String(r.voids), money(r.discrepancy_cents, c)]));

  y = heading(doc, y, 'Sessions de caisse');
  y = table(doc, y, [
    { title: 'Caissier', x: 14 }, { title: 'Ouverture', x: 60 }, { title: 'Fermeture', x: 90 }, { title: 'Attendu', x: 120 }, { title: 'Compté', x: 150 }, { title: 'Écart', x: 180 },
  ], report.sessions.map((s: any) => [
    s.cashier_name, dateTime(s.opened_at), s.status === 'open' ? 'ouverte' : dateTime(s.closed_at),
    s.expected_cents == null ? '-' : money(s.expected_cents, c), s.closing_counted_cents == null ? '-' : money(s.closing_counted_cents, c),
    s.discrepancy_cents == null ? '-' : money(s.discrepancy_cents, c),
  ]));

  if (report.voids.length) {
    y = heading(doc, y, 'Articles annulés');
    y = table(doc, y, [
      { title: 'Quand', x: 14 }, { title: 'Par', x: 45 }, { title: 'Produit', x: 85 }, { title: 'Montant', x: 140 }, { title: 'Motif', x: 170 },
    ], report.voids.map((v: any) => [dateTime(v.at), v.by, `${v.quantity} × ${v.product}`, money(v.amount_cents, c), v.reason || '-']));
  }

  y = heading(doc, y, 'Meilleurs produits');
  y = table(doc, y, [{ title: 'Produit', x: 14 }, { title: 'Qté', x: 130 }, { title: 'Ventes', x: 155 }],
    report.top_products.map((p: any) => [p.name, String(p.quantity), money(p.revenue_cents, c)]));

  if (report.stock_alerts.length) {
    y = heading(doc, y, 'Stock à surveiller');
    table(doc, y, [{ title: 'Produit', x: 14 }, { title: 'Reste', x: 130 }, { title: 'Seuil', x: 155 }],
      report.stock_alerts.map((i: any) => [i.name, String(i.quantity), String(i.threshold ?? '')]));
  }
  return doc;
}

/** End of a cashier's shift (CashRegisterService.getSessionDetail): to print, or send to the manager. */
export function buildShiftReportPdf(s: any, meta: { stationName?: string; cashierName?: string }): jsPDF {
  const c = s.currency;
  const doc = new jsPDF();
  let y = 18;
  doc.setFontSize(16);
  doc.text('Rapport de fin de service', 14, y);
  y += 7;
  doc.setFontSize(10);
  doc.text([meta.stationName, meta.cashierName].filter(Boolean).join(' · '), 14, y);
  y += 5;
  doc.text(`Caisse ${c} · ${dateTime(s.opened_at)} → ${s.closed_at ? dateTime(s.closed_at) : 'en cours'}`, 14, y);
  y += 10;

  const paid = (s.tickets || []).filter((t: any) => t.status === 'paid');
  const byMethod: Record<string, number> = {};
  for (const t of paid) {
    const rows = (t.payments || []).filter((p: any) => p.status === 'confirmed');
    if (!rows.length) byMethod[t.payment_method || 'cash'] = (byMethod[t.payment_method || 'cash'] || 0) + t.total_cents;
    for (const p of rows) byMethod[p.method] = (byMethod[p.method] || 0) + p.amount_cents;
  }
  const cashIn = (s.movements || []).filter((m: any) => m.type === 'cash_in').reduce((a: number, m: any) => a + m.amount_cents, 0);
  const cashOut = (s.movements || []).filter((m: any) => m.type === 'cash_out').reduce((a: number, m: any) => a + m.amount_cents, 0);

  y = heading(doc, y, 'Résumé');
  doc.setFontSize(10);
  for (const [k, v] of [
    ['Tickets payés', String(paid.length)],
    ['Ventes', money(paid.reduce((a: number, t: any) => a + t.total_cents, 0), c)],
    ...Object.entries(byMethod).map(([m, v]) => [`  dont ${METHOD_LABELS[m] || m}`, money(v, c)]),
    ['Fond de caisse', money(s.opening_float_cents, c)],
    ['Entrées / sorties', `+${money(cashIn, c)} / -${money(cashOut, c)}`],
    ['Espèces attendues', money(s.expected_cents, c)],
    ...(s.status === 'closed'
      ? [['Espèces comptées', money(s.closing_counted_cents, c)], ['Écart', `${s.discrepancy_cents > 0 ? '+' : ''}${money(s.discrepancy_cents, c)}`]]
      : []),
  ]) { doc.text(`${k} : ${v}`, 14, y); y += 5.5; }
  y += 4;

  if ((s.movements || []).length) {
    y = heading(doc, y, 'Mouvements');
    y = table(doc, y, [{ title: 'Heure', x: 14 }, { title: 'Type', x: 50 }, { title: 'Montant', x: 80 }, { title: 'Motif', x: 120 }],
      s.movements.map((m: any) => [dateTime(m.created_at), m.type === 'cash_in' ? 'Entrée' : 'Sortie', money(m.amount_cents, c), m.reason || '-']));
  }

  y = heading(doc, y, `Tickets (${(s.tickets || []).length})`);
  table(doc, y, [{ title: 'N°', x: 14 }, { title: 'Heure', x: 35 }, { title: 'Paiement', x: 75 }, { title: 'Montant', x: 120 }, { title: 'Statut', x: 160 }],
    (s.tickets || []).map((t: any) => [`#${t.ticket_number ?? '-'}`, dateTime(t.paid_at || t.created_at), METHOD_LABELS[t.payment_method] || '-', money(t.total_cents, c), t.status === 'paid' ? 'payé' : t.status === 'cancelled' ? 'annulé' : 'ouvert']));
  return doc;
}

/** Every station side by side (ReportsService.buildOrganizationReport). */
export function buildOrganizationReportPdf(report: any, meta: { orgName?: string; periodLabel: string }): jsPDF {
  const c = report.currency;
  const doc = new jsPDF();
  let y = 18;
  doc.setFontSize(16);
  doc.text(`Rapport — ${meta.orgName || 'Entreprise'} · toutes les stations`, 14, y);
  y += 7;
  doc.setFontSize(10);
  doc.text(`Période : ${meta.periodLabel} · Devise : ${c} · Généré le ${new Date().toLocaleString('fr-FR')}`, 14, y);
  y += 10;
  y = heading(doc, y, 'Par station');
  y = table(doc, y, [
    { title: 'Station', x: 14 }, { title: 'Ventes', x: 70 }, { title: 'Tickets', x: 105 }, { title: 'Espèces', x: 125 }, { title: 'Écart', x: 160 }, { title: 'Ruptures', x: 185 },
  ], report.stations.map((s: any) => [s.name, money(s.revenue_cents, c), String(s.tickets), money(s.cash_cents, c), money(s.discrepancy_cents, c), String(s.stock_alerts)]));
  doc.setFontSize(10);
  doc.text(`Total : ${money(report.totals.revenue_cents, c)} · ${report.totals.tickets} tickets · écart ${money(report.totals.discrepancy_cents, c)}`, 14, y);
  return doc;
}
