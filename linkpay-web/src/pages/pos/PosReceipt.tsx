import { Button } from '@/components/ui/button';
import { FormSheet } from '@/components/FormSheet';
import { formatCurrency, formatDate } from '@/lib/utils';
import { CheckCircle, Printer, Banknote, QrCode } from 'lucide-react';

const METHOD_LABELS: Record<string, string> = {
  cash: 'Espèces',
  scanlinkpay: 'ScanLinkPay',
  mixed: 'Mixte (espèces + ScanLinkPay)',
};

/**
 * The sale receipt — shown right after a ticket is settled and re-openable
 * from the sales history. HT / TVA / TTC per the spec; voided lines stay
 * visible (struck through) for traceability. "Imprimer" opens the system
 * print dialog (a dedicated thermal-printer layout can come later).
 */
export function PosReceipt({ ticket, onClose }: { ticket: any; onClose: () => void }) {
  const items: any[] = ticket.items || [];
  const active = items.filter((i) => i.status !== 'voided');
  const voided = items.filter((i) => i.status === 'voided');
  const payments: any[] = ticket.payments || [];
  const tvaRate = Number(ticket.merchant?.pos_tva_rate_pct ?? 0);
  const cashPayments = payments.filter((p) => p.method === 'cash');
  const change = cashPayments.reduce((sum, p) => sum + Math.max(0, (p.received_cents ?? p.amount_cents) - p.amount_cents), 0);

  return (
    <FormSheet onClose={onClose} title="Reçu de vente">
      <div className="p-6 max-w-sm mx-auto space-y-4">
        <div className="pos-receipt-print space-y-4">
        <div className="text-center space-y-1">
          <CheckCircle className="w-10 h-10 text-success mx-auto" />
          <p className="font-bold text-lg text-foreground">{ticket.merchant?.name || 'Boutique'}</p>
          {ticket.merchant?.address && <p className="text-xs text-muted-foreground">{ticket.merchant.address}</p>}
          {ticket.merchant?.phone && <p className="text-xs text-muted-foreground">{ticket.merchant.phone}</p>}
          <p className="text-sm text-muted-foreground pt-1">
            Ticket #{ticket.ticket_number ?? '—'} · {formatDate(ticket.paid_at || ticket.updated_at)}
          </p>
        </div>

        <div className="border-y border-dashed border-border py-3 space-y-1.5">
          {active.map((item: any) => (
            <div key={item.id} className="flex justify-between gap-2 text-sm">
              <span className="text-foreground truncate">
                {item.quantity} × {item.product_name_snapshot}
              </span>
              <span className="font-medium text-foreground flex-shrink-0">{formatCurrency(item.line_total_cents, ticket.currency)}</span>
            </div>
          ))}
          {voided.map((item: any) => (
            <div key={item.id} className="flex justify-between gap-2 text-xs text-muted-foreground">
              <span className="line-through truncate">{item.quantity} × {item.product_name_snapshot}</span>
              <span className="flex-shrink-0">annulée</span>
            </div>
          ))}
        </div>

        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Sous-total HT</span>
            <span className="text-foreground">{formatCurrency(ticket.subtotal_cents || 0, ticket.currency)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">TVA ({tvaRate}%)</span>
            <span className="text-foreground">{formatCurrency(ticket.tva_cents || 0, ticket.currency)}</span>
          </div>
          <div className="flex justify-between text-base font-bold border-t border-border pt-1.5">
            <span className="text-foreground">Total TTC</span>
            <span className="text-foreground">{formatCurrency(ticket.total_cents, ticket.currency)}</span>
          </div>
        </div>

        <div className="space-y-1 text-sm border-t border-dashed border-border pt-3">
          {payments.length ? (
            payments.map((p: any) => (
              <div key={p.id} className="flex justify-between items-center">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  {p.method === 'cash' ? <Banknote className="w-3.5 h-3.5" /> : <QrCode className="w-3.5 h-3.5" />}
                  {METHOD_LABELS[p.method] || p.method}
                  {p.method === 'cash' && p.received_cents > p.amount_cents && (
                    <span className="text-xs">(reçu {formatCurrency(p.received_cents, ticket.currency)})</span>
                  )}
                </span>
                <span className="text-foreground">{formatCurrency(p.amount_cents, ticket.currency)}</span>
              </div>
            ))
          ) : (
            // Legacy ticket settled before pos_ticket_payments existed.
            <div className="flex justify-between">
              <span className="text-muted-foreground">Paiement</span>
              <span className="text-foreground">{METHOD_LABELS[ticket.payment_method] || ticket.payment_method || '—'}</span>
            </div>
          )}
          {change > 0 && (
            <div className="flex justify-between font-semibold">
              <span className="text-foreground">Monnaie rendue</span>
              <span className="text-foreground">{formatCurrency(change, ticket.currency)}</span>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground">Merci de votre visite — propulsé par ScanLinkPay</p>
        </div>

        <div className="flex gap-3 pos-no-print">
          <Button variant="outline" className="flex-1" onClick={() => window.print()}>
            <Printer className="mr-2 w-4 h-4" /> Imprimer
          </Button>
          <Button className="flex-1" onClick={onClose}>Nouvelle vente</Button>
        </div>
      </div>
    </FormSheet>
  );
}
