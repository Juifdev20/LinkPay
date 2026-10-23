import { ArrowDownLeft, ArrowDownToLine, ArrowUpFromLine, Send, ShoppingCart, SlidersHorizontal, Store, CreditCard, Sparkles, Undo2, type LucideIcon } from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';

/** How each kind of wallet movement looks (icon, colour, title), as in the design. */
const KINDS: Record<string, { icon: LucideIcon; tone: string; in: string; out: string }> = {
  TOPUP: { icon: ArrowDownToLine, tone: 'bg-emerald-500', in: 'Rechargement mobile', out: 'Rechargement mobile' },
  TRANSFER_IN: { icon: ArrowDownLeft, tone: 'bg-emerald-500', in: "Réception d'argent", out: "Réception d'argent" },
  TRANSFER_OUT: { icon: Send, tone: 'bg-rose-500', in: "Envoi d'argent", out: "Envoi d'argent" },
  PAYMENT: { icon: ShoppingCart, tone: 'bg-sky-500', in: 'Vente encaissée', out: 'Paiement marchand' },
  WITHDRAWAL: { icon: ArrowUpFromLine, tone: 'bg-orange-500', in: 'Retrait', out: 'Retrait' },
  REFUND: { icon: Undo2, tone: 'bg-teal-500', in: 'Remboursement reçu', out: 'Remboursement' },
  SUBSCRIPTION: { icon: Sparkles, tone: 'bg-blue-700', in: 'Abonnement', out: 'Abonnement' },
  CARD: { icon: CreditCard, tone: 'bg-blue-900', in: 'Carte', out: 'Carte' },
  SETTLEMENT: { icon: Store, tone: 'bg-sky-500', in: 'Règlement', out: 'Règlement' },
};
const OTHER = { icon: SlidersHorizontal, tone: 'bg-slate-500', in: 'Ajustement', out: 'Ajustement' };

export function ledgerTitle(entry: { entry_type: string; direction: string }) {
  const k = KINDS[entry.entry_type] || OTHER;
  return entry.direction === 'credit' ? k.in : k.out;
}

function when(date: string) {
  const d = new Date(date);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Aujourd'hui, ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Hier, ${time}`;
  return `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}, ${time}`;
}

/** One wallet movement: coloured round icon, what it was, with whom, when, and the signed amount. */
export function LedgerItem({ entry }: { entry: any }) {
  const k = KINDS[entry.entry_type] || OTHER;
  const credit = entry.direction === 'credit';
  const Icon = k.icon;
  return (
    <div className="flex items-center gap-3 py-3">
      <span className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-white shadow-sm', k.tone)}>
        <Icon className="h-[18px] w-[18px]" strokeWidth={2.2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{ledgerTitle(entry)}</p>
        {entry.counterparty && <p className="truncate text-xs text-muted-foreground">{entry.counterparty}</p>}
        <p className="text-[11px] text-muted-foreground/80">{when(entry.created_at)}</p>
      </div>
      <span className={cn('flex-shrink-0 text-sm font-bold tabular-nums', credit ? 'text-success' : 'text-destructive')}>
        {credit ? '+ ' : '- '}
        {formatCurrency(entry.amount_cents, entry.currency).replace(/,00(?=\s)/, '')}
      </span>
    </div>
  );
}
