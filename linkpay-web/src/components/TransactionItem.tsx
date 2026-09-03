import type { ReactNode } from 'react';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { ArrowDownLeft, ArrowUpRight, Clock, XCircle, CheckCircle2 } from 'lucide-react';

interface TransactionItemProps {
  name: string;
  amountCents: number;
  currency?: string;
  status: 'SUCCESS' | 'PENDING' | 'FAILED' | 'REFUNDED';
  date: string;
  type?: 'in' | 'out';
  /** Optional trailing control (e.g. a refund icon button) — rendered as
   * part of this component's own flex row so it never fights a sibling
   * wrapper for width/overlaps the status badge. */
  action?: ReactNode;
}

const statusConfig = {
  SUCCESS: { icon: CheckCircle2, color: 'text-success', bg: 'bg-success/10' },
  PENDING: { icon: Clock, color: 'text-warning', bg: 'bg-warning/10' },
  FAILED: { icon: XCircle, color: 'text-destructive', bg: 'bg-destructive/10' },
  REFUNDED: { icon: ArrowDownLeft, color: 'text-muted-foreground', bg: 'bg-muted' },
};

export function TransactionItem({
  name,
  amountCents,
  currency = 'CDF',
  status,
  date,
  type = 'out',
  action,
}: TransactionItemProps) {
  const cfg = statusConfig[status];
  const StatusIcon = cfg.icon;
  const DirectionIcon = type === 'in' ? ArrowDownLeft : ArrowUpRight;

  return (
    <div className="flex items-center gap-3 py-3 border-b border-border last:border-0">
      <div
        className={cn(
          'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0',
          type === 'in' ? 'bg-success/10' : 'bg-secondary',
        )}
      >
        <DirectionIcon className={cn('w-5 h-5', type === 'in' ? 'text-success' : 'text-muted-foreground')} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-foreground truncate">{name}</p>
        <p className="text-xs text-muted-foreground">{formatDate(date)}</p>
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        <span className={cn('font-bold text-sm', type === 'in' ? 'text-success' : 'text-foreground')}>
          {type === 'in' ? '+' : '-'}{formatCurrency(amountCents, currency)}
        </span>
        <div className={cn('flex items-center gap-1', cfg.color)}>
          <StatusIcon className="w-3 h-3" />
          <span className="text-[10px] font-medium">{status}</span>
        </div>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}
