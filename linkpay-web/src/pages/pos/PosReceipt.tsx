import { useState } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { FormSheet } from '@/components/FormSheet';
import { formatCurrency, formatDate } from '@/lib/utils';
import { CheckCircle, Printer, Loader2 } from 'lucide-react';

const METHOD_LABELS: Record<string, string> = {
  cash: 'Espèces',
  scanlinkpay: 'ScanLinkPay',
  mixed: 'Mixte (espèces + ScanLinkPay)',
};

const Sep = () => <div className="border-t border-dashed border-neutral-400 my-2" />;

// ------------------------------------------------------------------
// Plain-text ticket for "Generic / Text Only" printer drivers (most USB
// thermal POS printers): the driver rasterizes raw text, so we send a
// pre-formatted monospace ticket instead of HTML — that keeps columns
// aligned. ASCII only: those drivers use old codepages that mangle
// accents and non-breaking spaces (the "á" garbage seen on real prints).
// ------------------------------------------------------------------
const RECEIPT_WIDTH = 32; // chars — safe for both 58mm and 80mm rolls

const ascii = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[  ]/g, ' ')
    .replace(/[^\x20-\x7E]/g, ' ');

const money = (cents: number, currency: string) =>
  ascii(formatCurrency(cents, currency)).replace(/\s+/g, ' ').trim();

const center = (s: string) => {
  const t = ascii(s);
  if (t.length >= RECEIPT_WIDTH) return t.slice(0, RECEIPT_WIDTH);
  const left = Math.floor((RECEIPT_WIDTH - t.length) / 2);
  return ' '.repeat(left) + t;
};

const row = (left: string, right: string) => {
  const l = ascii(left);
  const r = ascii(right);
  if (l.length + r.length + 1 > RECEIPT_WIDTH) {
    return `${l.slice(0, Math.max(0, RECEIPT_WIDTH - r.length - 1))} ${r}`;
  }
  return l + ' '.repeat(RECEIPT_WIDTH - l.length - r.length) + r;
};

const HR = '-'.repeat(RECEIPT_WIDTH);

function receiptText(ticket: any): string {
  const items: any[] = ticket.items || [];
  const payments: any[] = ticket.payments || [];
  const tvaRate = Number(ticket.merchant?.pos_tva_rate_pct ?? 0);
  const change = payments
    .filter((p) => p.method === 'cash')
    .reduce((sum, p) => sum + Math.max(0, (p.received_cents ?? p.amount_cents) - p.amount_cents), 0);
  const orgName = ticket.merchant?.organization_name;
  const cur = ticket.currency;

  const lines: string[] = [
    center(orgName || ticket.merchant?.name || 'Boutique'),
    ...(orgName && ticket.merchant?.name ? [center(ticket.merchant.name)] : []),
    ...(ticket.merchant?.address ? [center(ticket.merchant.address)] : []),
    ...(ticket.merchant?.phone ? [center(ticket.merchant.phone)] : []),
    HR,
    row(`Ticket #${ticket.ticket_number ?? '-'}`, formatDate(ticket.paid_at || ticket.updated_at)),
    HR,
  ];

  for (const item of items.filter((i) => i.status !== 'voided')) {
    lines.push(row(`${item.quantity} x ${item.product_name_snapshot}`, money(item.line_total_cents, cur)));
  }
  for (const item of items.filter((i) => i.status === 'voided')) {
    lines.push(row(`${item.quantity} x ${item.product_name_snapshot}`, 'annulee'));
  }

  lines.push(
    HR,
    row('Sous-total HT', money(ticket.subtotal_cents || 0, cur)),
    row(`TVA (${tvaRate}%)`, money(ticket.tva_cents || 0, cur)),
    row('TOTAL TTC', money(ticket.total_cents, cur)),
    HR,
  );

  if (payments.length) {
    for (const p of payments) {
      lines.push(row(METHOD_LABELS[p.method] || p.method, money(p.amount_cents, cur)));
      if (p.method === 'cash' && p.received_cents > p.amount_cents) {
        lines.push(row('  Recu', money(p.received_cents, cur)));
      }
    }
  } else {
    lines.push(row('Paiement', METHOD_LABELS[ticket.payment_method] || ticket.payment_method || '-'));
  }
  if (change > 0) lines.push(row('Monnaie rendue', money(change, cur)));

  lines.push(
    HR,
    center('Merci de votre visite'),
    center('ScanLinkPay'),
    // Feed past the cutter: without enough trailing blank lines the next
    // print starts under the tear edge (footer of ticket N lands on top
    // of ticket N+1, and N's own tail gets clipped).
    '', '', '', '', '', '', '', '',
  );
  return lines.join('\n');
}

/**
 * The sale receipt — thermal-printer style (~80mm ticket), shown right after
 * a ticket is settled and re-openable from the sales history. Header shows
 * the ORGANIZATION name then the boutique (multi-tenant: clients must see
 * which business they paid, whichever store served them). HT / TVA / TTC per
 * the spec; voided lines stay visible (struck through) for traceability.
 * "Imprimer" outputs just the ticket — see .pos-receipt-print in index.css.
 */
export function PosReceipt({ ticket, onClose }: { ticket: any; onClose: () => void }) {
  const items: any[] = ticket.items || [];
  const active = items.filter((i) => i.status !== 'voided');
  const voided = items.filter((i) => i.status === 'voided');
  const payments: any[] = ticket.payments || [];
  const tvaRate = Number(ticket.merchant?.pos_tva_rate_pct ?? 0);
  const cashPayments = payments.filter((p) => p.method === 'cash');
  const change = cashPayments.reduce((sum, p) => sum + Math.max(0, (p.received_cents ?? p.amount_cents) - p.amount_cents), 0);
  const orgName = ticket.merchant?.organization_name;
  const [printing, setPrinting] = useState(false);
  const [printers, setPrinters] = useState<string[] | null>(null);
  const printerKey = 'pos-printer-name';
  const savedPrinter = () => localStorage.getItem(printerKey) || '';

  // First print on this machine: the cashier picks the printer once from
  // the local list; it's then saved and every later print goes straight
  // out — no dialog, no re-selection.
  const print = async () => {
    const printer = savedPrinter();
    if (!printer) {
      try {
        const { data } = await api.get(`/merchants/${ticket.merchant_id}/pos/printers`);
        if (data.printers?.length) { setPrinters(data.printers); return; }
      } catch { /* no local printers — fall through to browser print */ }
      window.print();
      return;
    }
    setPrinting(true);
    try {
      await api.post(`/merchants/${ticket.merchant_id}/pos/print-receipt`, {
        text: receiptText(ticket),
        printer,
      });
    } catch {
      window.print();
    } finally {
      setPrinting(false);
    }
  };

  const choosePrinter = async (printer: string) => {
    localStorage.setItem(printerKey, printer);
    setPrinters(null);
    setPrinting(true);
    try {
      await api.post(`/merchants/${ticket.merchant_id}/pos/print-receipt`, {
        text: receiptText(ticket),
        printer,
      });
    } catch {
      window.print();
    } finally {
      setPrinting(false);
    }
  };

  return (
    <FormSheet onClose={onClose} title="Reçu de vente">
      <div className="p-6 space-y-4">
        <div className="flex justify-center pos-no-print">
          <CheckCircle className="w-10 h-10 text-success" />
        </div>

        {/* Screen preview — thermal-look card. */}
        <div className="mx-auto w-[300px] bg-white text-black font-mono text-[12px] leading-snug p-5 rounded-lg shadow-md border border-neutral-200">
          {/* Header — org identity first (multi-tenant), boutique below */}
          <div className="text-center">
            <p className="text-[15px] font-bold uppercase tracking-wide leading-tight">
              {orgName || ticket.merchant?.name || 'Boutique'}
            </p>
            {orgName && ticket.merchant?.name && (
              <p className="font-semibold mt-0.5">{ticket.merchant.name}</p>
            )}
            {ticket.merchant?.address && <p className="text-[11px] mt-0.5">{ticket.merchant.address}</p>}
            {ticket.merchant?.phone && <p className="text-[11px]">{ticket.merchant.phone}</p>}
          </div>

          <Sep />

          <div className="flex justify-between text-[11px]">
            <span>Ticket #{ticket.ticket_number ?? '—'}</span>
            <span>{formatDate(ticket.paid_at || ticket.updated_at)}</span>
          </div>

          <Sep />

          {/* Lines */}
          <div className="space-y-1">
            {active.map((item: any) => (
              <div key={item.id} className="flex justify-between gap-2">
                <span className="truncate">
                  {item.quantity} × {item.product_name_snapshot}
                </span>
                <span className="flex-shrink-0">{formatCurrency(item.line_total_cents, ticket.currency)}</span>
              </div>
            ))}
            {voided.map((item: any) => (
              <div key={item.id} className="flex justify-between gap-2 text-[11px] text-neutral-500">
                <span className="line-through truncate">{item.quantity} × {item.product_name_snapshot}</span>
                <span className="flex-shrink-0">annulée</span>
              </div>
            ))}
          </div>

          <Sep />

          {/* Totals */}
          <div className="space-y-1">
            <div className="flex justify-between">
              <span>Sous-total HT</span>
              <span>{formatCurrency(ticket.subtotal_cents || 0, ticket.currency)}</span>
            </div>
            <div className="flex justify-between">
              <span>TVA ({tvaRate}%)</span>
              <span>{formatCurrency(ticket.tva_cents || 0, ticket.currency)}</span>
            </div>
            <div className="flex justify-between text-[15px] font-bold pt-0.5">
              <span>TOTAL TTC</span>
              <span>{formatCurrency(ticket.total_cents, ticket.currency)}</span>
            </div>
          </div>

          <Sep />

          {/* Payments */}
          <div className="space-y-1">
            {payments.length ? (
              payments.map((p: any) => (
                <div key={p.id}>
                  <div className="flex justify-between">
                    <span>{METHOD_LABELS[p.method] || p.method}</span>
                    <span>{formatCurrency(p.amount_cents, ticket.currency)}</span>
                  </div>
                  {p.method === 'cash' && p.received_cents > p.amount_cents && (
                    <div className="flex justify-between text-[11px] text-neutral-600">
                      <span>Reçu</span>
                      <span>{formatCurrency(p.received_cents, ticket.currency)}</span>
                    </div>
                  )}
                </div>
              ))
            ) : (
              // Legacy ticket settled before pos_ticket_payments existed.
              <div className="flex justify-between">
                <span>Paiement</span>
                <span>{METHOD_LABELS[ticket.payment_method] || ticket.payment_method || '—'}</span>
              </div>
            )}
            {change > 0 && (
              <div className="flex justify-between font-bold">
                <span>Monnaie rendue</span>
                <span>{formatCurrency(change, ticket.currency)}</span>
              </div>
            )}
          </div>

          <Sep />

          <p className="text-center text-[11px]">Merci de votre visite</p>
          <p className="text-center text-[10px] text-neutral-500">propulsé par ScanLinkPay</p>
        </div>

        {/* What actually goes to the printer: raw pre-formatted text —
            "Generic / Text Only" drivers on thermal printers can't render
            HTML (they'd flatten flex columns and mangle accents/nbsp). */}
        <pre className="pos-receipt-print hidden font-mono text-[11px] leading-tight text-black whitespace-pre">{receiptText(ticket)}</pre>

        {/* One-time printer picker — shown only until a printer is saved */}
        {printers && (
          <div className="max-w-sm mx-auto space-y-2 pos-no-print">
            <p className="text-sm font-medium text-foreground text-center">Choisissez l'imprimante (une seule fois)</p>
            <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
              {printers.map((p) => (
                <button
                  key={p}
                  onClick={() => choosePrinter(p)}
                  disabled={printing}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left hover:bg-accent disabled:opacity-50"
                >
                  <Printer className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  {p}
                </button>
              ))}
            </div>
            <button onClick={() => setPrinters(null)} className="w-full text-xs text-muted-foreground hover:underline">
              Annuler — imprimer via le navigateur
            </button>
          </div>
        )}

        <div className="flex gap-3 max-w-sm mx-auto pos-no-print">
          <Button variant="outline" className="flex-1" onClick={print} disabled={printing}>
            {printing ? <Loader2 className="mr-2 w-4 h-4 animate-spin" /> : <Printer className="mr-2 w-4 h-4" />}
            Imprimer
          </Button>
          <Button className="flex-1" onClick={onClose}>Nouvelle vente</Button>
        </div>
      </div>
    </FormSheet>
  );
}
