import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils';

interface BalanceCardProps {
  balanceCents: number;
  currency?: string;
  label?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function BalanceCard({
  balanceCents,
  currency = 'CDF',
  label = 'Solde disponible',
  actions,
  className,
}: BalanceCardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl bg-gradient-to-br from-primary to-indigo-600 p-6 text-primary-foreground shadow-lg shadow-primary/20',
        className,
      )}
    >
      <p className="text-sm font-medium text-primary-foreground/80">{label}</p>
      <p className="text-3xl font-bold mt-2 tracking-tight">
        {formatCurrency(balanceCents, currency)}
      </p>
      {actions && <div className="mt-4 flex gap-3">{actions}</div>}
    </div>
  );
}
