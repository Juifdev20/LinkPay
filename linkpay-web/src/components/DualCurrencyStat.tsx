import { formatCurrency } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface DualCurrencyStatProps {
  amounts: { CDF: number; USD: number };
  className?: string;
  /** Smaller amounts that wrap instead of overflowing — for narrow tiles. */
  compact?: boolean;
}

/** Two stacked amounts (CDF then USD) for a stat tile — never summed together, they're independent balances. */
export function DualCurrencyStat({ amounts, className, compact }: DualCurrencyStatProps) {
  const amountClass = compact
    ? 'text-[15px] font-bold text-foreground leading-tight [overflow-wrap:anywhere]'
    : 'text-lg font-bold text-foreground leading-tight';
  return (
    <div className={cn(className)}>
      <p className={amountClass}>{formatCurrency(amounts?.CDF || 0, 'CDF')}</p>
      <p className={amountClass}>{formatCurrency(amounts?.USD || 0, 'USD')}</p>
    </div>
  );
}
