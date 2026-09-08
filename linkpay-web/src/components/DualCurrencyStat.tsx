import { formatCurrency } from '@/lib/utils';

interface DualCurrencyStatProps {
  amounts: { CDF: number; USD: number };
  className?: string;
}

/** Two stacked amounts (CDF then USD) for a stat tile — never summed together, they're independent balances. */
export function DualCurrencyStat({ amounts, className }: DualCurrencyStatProps) {
  return (
    <div className={className}>
      <p className="text-lg font-bold text-foreground leading-tight">{formatCurrency(amounts?.CDF || 0, 'CDF')}</p>
      <p className="text-lg font-bold text-foreground leading-tight">{formatCurrency(amounts?.USD || 0, 'USD')}</p>
    </div>
  );
}
