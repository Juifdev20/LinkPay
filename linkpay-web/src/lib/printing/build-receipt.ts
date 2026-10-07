import { formatCurrency, formatDate } from '@/lib/utils';
import type { ReceiptLine } from './types';

const METHOD_LABELS: Record<string, string> = {
  cash: 'Espèces',
  scanlinkpay: 'ScanLinkPay',
  mixed: 'Mixte',
};

/**
 * Shelf / product label: name, price, scannable barcode. `copies` labels
 * are printed back to back, separated by a cut line. The price shown is
 * informative only — the till always takes the price from the database.
 */
export function buildProductLabel(
  product: { name: string; barcode: string; unit_price_cents: number; currency: string },
  copies = 1,
): ReceiptLine[] {
  const one: ReceiptLine[] = [
    { type: 'subtitle', text: product.name },
    { type: 'amount', label: 'Prix', value: formatCurrency(product.unit_price_cents, product.currency), large: true },
    { type: 'barcode', value: product.barcode },
  ];
  const lines: ReceiptLine[] = [];
  for (let i = 0; i < copies; i++) {
    if (i > 0) lines.push({ type: 'text', text: ' ' }, { type: 'separator' }, { type: 'text', text: ' ' });
    lines.push(...one);
  }
  return lines;
}

/**
 * POS ticket → receipt lines. Header shows the ORGANIZATION name then the
 * boutique (multi-tenant: clients must see which business they paid,
 * whichever store served them). HT / TVA / TTC per the spec; voided lines
 * stay on the receipt for traceability.
 */
export function buildPosReceipt(ticket: any): ReceiptLine[] {
  const items: any[] = ticket.items || [];
  const payments: any[] = ticket.payments || [];
  const tvaRate = Number(ticket.merchant?.pos_tva_rate_pct ?? 0);
  const orgName = ticket.merchant?.organization_name;
  const cur = ticket.currency;
  const money = (cents: number) => formatCurrency(cents, cur);
  const change = payments
    .filter((p) => p.method === 'cash')
    .reduce((sum, p) => sum + Math.max(0, (p.received_cents ?? p.amount_cents) - p.amount_cents), 0);

  const lines: ReceiptLine[] = [{ type: 'title', text: orgName || ticket.merchant?.name || 'Boutique' }];
  if (orgName && ticket.merchant?.name) lines.push({ type: 'subtitle', text: ticket.merchant.name });
  if (ticket.merchant?.address) lines.push({ type: 'text', text: ticket.merchant.address, align: 'center', small: true });
  if (ticket.merchant?.phone) lines.push({ type: 'text', text: ticket.merchant.phone, align: 'center', small: true });

  lines.push(
    { type: 'separator' },
    { type: 'field', label: `Ticket #${ticket.ticket_number ?? '-'}`, value: formatDate(ticket.paid_at || ticket.updated_at) },
    { type: 'separator' },
  );

  for (const item of items.filter((i) => i.status !== 'voided')) {
    lines.push({ type: 'field', label: `${item.quantity} x ${item.product_name_snapshot}`, value: money(item.line_total_cents) });
  }
  for (const item of items.filter((i) => i.status === 'voided')) {
    lines.push({ type: 'field', label: `${item.quantity} x ${item.product_name_snapshot}`, value: 'annulée', muted: true });
  }

  lines.push(
    { type: 'separator' },
    { type: 'field', label: 'Sous-total HT', value: money(ticket.subtotal_cents || 0) },
    { type: 'field', label: `TVA (${tvaRate}%)`, value: money(ticket.tva_cents || 0) },
    { type: 'amount', label: 'TOTAL TTC', value: money(ticket.total_cents), large: true },
    { type: 'separator' },
  );

  if (payments.length) {
    for (const p of payments) {
      lines.push({ type: 'field', label: METHOD_LABELS[p.method] || p.method, value: money(p.amount_cents) });
      if (p.method === 'cash' && p.received_cents > p.amount_cents) {
        lines.push({ type: 'field', label: '  Reçu', value: money(p.received_cents), muted: true });
      }
    }
  } else {
    // Legacy ticket settled before pos_ticket_payments existed.
    lines.push({ type: 'field', label: 'Paiement', value: METHOD_LABELS[ticket.payment_method] || ticket.payment_method || '-' });
  }
  if (change > 0) lines.push({ type: 'amount', label: 'Monnaie rendue', value: money(change) });

  lines.push(
    { type: 'separator' },
    { type: 'text', text: 'Merci de votre visite', align: 'center' },
    { type: 'text', text: 'propulsé par ScanLinkPay', align: 'center', small: true },
  );
  return lines;
}
