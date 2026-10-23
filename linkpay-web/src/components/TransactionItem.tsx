import type { ReactNode } from 'react';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { ArrowDownLeft, ArrowUpRight, Clock, XCircle, CheckCircle2, Undo2 } from 'lucide-react';

interface TransactionItemProps {
  name: string;
  amountCents: number;
  currency?: string;
  status: 'SUCCESS' | 'PENDING' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
  date: string;
  type?: 'in' | 'out';
  /** Optional trailing control (e.g. a refund icon button) — rendered as
   * part of this component's own flex row so it never fights a sibling
   * wrapper for width/overlaps the status badge. */
  action?: ReactNode;
  /** Second line under the name (e.g. the reference); the date goes after it. */
  subtitle?: string;
}

const statusConfig = {
  SUCCESS: { icon: CheckCircle2, label: 'Réussi', color: 'text-success', bg: 'bg-success/10' },
  PENDING: { icon: Clock, label: 'En attente', color: 'text-warning', bg: 'bg-warning/10' },
  FAILED: { icon: XCircle, label: 'Échoué', color: 'text-destructive', bg: 'bg-destructive/10' },
  REFUNDED: { icon: Undo2, label: 'Remboursé', color: 'text-muted-foreground', bg: 'bg-muted' },
  PARTIALLY_REFUNDED: { icon: Undo2, label: 'Remb. en partie', color: 'text-muted-foreground', bg: 'bg-muted' },
};

export function TransactionItem({
  name,
  amountCents,
  currency = 'CDF',
  status,
  date,
  type = 'out',
  action,
  subtitle,
}: TransactionItemProps) {
  const cfg = statusConfig[status] ?? statusConfig.PENDING;
  const StatusIcon = cfg.icon;
  const DirectionIcon = type === 'in' ? ArrowDownLeft : ArrowUpRight;

  return (
    <div className="flex items-center gap-3 border-b border-border py-3.5 last:border-0">
      <div
        className={cn(
          'flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl',
          type === 'in' ? 'bg-success/10' : 'bg-primary/10',
        )}
      >
        <DirectionIcon className={cn('h-5 w-5', type === 'in' ? 'text-success' : 'text-primary')} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{name}</p>
        <p className="truncate text-xs text-muted-foreground">{formatDate(date)}</p>
        {subtitle && <p className="truncate font-mono text-[11px] text-muted-foreground/80">{subtitle}</p>}
      </div>
      <div className="flex flex-shrink-0 flex-col items-end gap-1">
        <span className={cn('text-sm font-bold tabular-nums', type === 'in' ? 'text-success' : 'text-foreground')}>
          {type === 'in' ? '+' : '-'}{formatCurrency(amountCents, currency)}
        </span>
        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold', cfg.color, cfg.bg)}>
          <StatusIcon className="h-3 w-3" />
          {cfg.label}
        </span>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}
