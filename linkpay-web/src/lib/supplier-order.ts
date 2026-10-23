import { jsPDF } from 'jspdf';
import { formatCurrency, formatDate } from '@/lib/utils';
import { deliverPdf } from '@/lib/report-pdf';

/** Orders between enterprises (supplier network, DECISIONS.md 23/10): labels and the printable ticket of each step. */

export type OrderStatus = 'submitted' | 'confirmed' | 'paid' | 'delivered' | 'received' | 'refused' | 'cancelled';

export const ORDER_STATUS: Record<OrderStatus, { client: string; supplier: string; variant: 'warning' | 'success' | 'error' | 'secondary' }> = {
  submitted: { client: 'Envoyée — attend le fournisseur', supplier: 'À confirmer', variant: 'warning' },
  confirmed: { client: 'À payer', supplier: 'Attend le paiement', variant: 'warning' },
  paid: { client: 'Payée — livraison à venir', supplier: 'Payée — à livrer', variant: 'success' },
  delivered: { client: 'Livrée — à réceptionner', supplier: 'Livrée', variant: 'success' },
  received: { client: 'Reçue', supplier: 'Terminée', variant: 'secondary' },
  refused: { client: 'Refusée', supplier: 'Refusée', variant: 'error' },
  cancelled: { client: 'Annulée', supplier: 'Annulée par le client', variant: 'error' },
};

export const PAYMENT_LABEL: Record<string, string> = { scanlinkpay: 'ScanLinkPay', cash: 'Espèces', mobile_money: 'Mobile Money' };

/** The ticket of the step the order is at: order form, payment receipt, delivery note. */
export function ticketTitle(status: OrderStatus) {
  if (status === 'paid') return 'Reçu de paiement';
  if (status === 'delivered' || status === 'received') return 'Bon de livraison';
  return 'Bon de commande';
}

const money = (cents: number, currency: string) => formatCurrency(cents || 0, currency).replace(/[  ]/g, ' ');

/** A4 ticket of an order at its current step, shared (phone) or downloaded (computer). */
export async function printOrderTicket(order: any) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const title = ticketTitle(order.status);
  let y = 18;
  doc.setFont('helvetica', 'bold').setFontSize(16).text(title, 15, y);
  doc.setFont('helvetica', 'normal').setFontSize(10).text(`Commande ${order.number} · ${formatDate(order.created_at)}`, 15, (y += 7));
  y += 8;
  doc.setFont('helvetica', 'bold').text('Fournisseur', 15, y).text('Client', 110, y);
  doc.setFont('helvetica', 'normal');
  const sup = [order.supplier_name, order.supplier_number ? `N° ${order.supplier_number}` : '', order.supplier_phone || '', order.supplier_station_name ? `Départ : ${order.supplier_station_name}` : ''].filter(Boolean);
  const cli = [order.client_name, order.client_station_name ? `Station : ${order.client_station_name}` : '', order.delivery_requested ? `Livraison : ${order.delivery_address || 'à convenir'}` : 'Retrait chez le fournisseur'].filter(Boolean);
  sup.forEach((l, i) => doc.text(l, 15, y + 5 + i * 5));
  cli.forEach((l, i) => doc.text(l, 110, y + 5 + i * 5));
  y += 8 + Math.max(sup.length, cli.length) * 5;

  doc.setFont('helvetica', 'bold');
  doc.text('Produit', 15, y).text('Qté', 120, y, { align: 'right' }).text('Prix unitaire', 155, y, { align: 'right' }).text('Total', 195, y, { align: 'right' });
  doc.setDrawColor(200).line(15, y + 2, 195, y + 2);
  doc.setFont('helvetica', 'normal');
  y += 8;
  for (const l of order.items || []) {
    if (y > 270) { doc.addPage(); y = 20; }
    doc.text(doc.splitTextToSize(l.name, 95)[0], 15, y);
    doc.text(String(l.quantity), 120, y, { align: 'right' });
    doc.text(money(l.unit_price_cents, order.currency), 155, y, { align: 'right' });
    doc.text(money(l.unit_price_cents * l.quantity, order.currency), 195, y, { align: 'right' });
    y += 6;
  }
  doc.line(15, y - 2, 195, y - 2);
  y += 4;
  const row = (label: string, value: string, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal').text(label, 155, y, { align: 'right' }).text(value, 195, y, { align: 'right' });
    y += 6;
  };
  row('Produits', money(order.subtotal_cents, order.currency));
  if (order.delivery_requested) row('Livraison', order.status === 'submitted' ? 'à fixer par le fournisseur' : money(order.delivery_fee_cents, order.currency));
  row('Total', money(order.total_cents, order.currency), true);

  y += 6;
  doc.setFont('helvetica', 'normal').setFontSize(9);
  const steps = [
    order.confirmed_at && `Confirmée le ${formatDate(order.confirmed_at)}`,
    order.paid_at && `Payée le ${formatDate(order.paid_at)} (${PAYMENT_LABEL[order.payment_method] || order.payment_method}${order.payment_reference ? `, réf. ${order.payment_reference}` : ''})`,
    order.delivered_at && `Livrée le ${formatDate(order.delivered_at)}`,
    order.received_at && `Reçue le ${formatDate(order.received_at)}`,
  ].filter(Boolean) as string[];
  steps.forEach((s) => { doc.text(s, 15, y); y += 5; });
  if (order.note) { doc.text(doc.splitTextToSize(`Note du client : ${order.note}`, 180), 15, y); y += 10; }
  if (order.supplier_note) { doc.text(doc.splitTextToSize(`Note du fournisseur : ${order.supplier_note}`, 180), 15, y); y += 10; }
  doc.setTextColor(130).text('Édité avec ScanLinkPay — réseau de fournisseurs', 15, 288);
  await deliverPdf(doc, `${title.toLowerCase().replace(/\s+/g, '-')}-${order.number}.pdf`, `Partager le ${title.toLowerCase()}`);
}
