import { cn } from '@/lib/utils';
import { CURRENCIES } from '@/lib/constants';

interface CurrencySelectorProps {
  value: 'CDF' | 'USD';
  onChange: (currency: 'CDF' | 'USD') => void;
  className?: string;
  /** Compact pill style (for embedding in a dark card, e.g. BalanceCard) vs the default bordered-button style used in forms. */
  variant?: 'default' | 'pill';
}

/**
 * Segmented CDF/USD control — the single entry point for "which currency am
 * I acting in" across recharge, envoi, retrait, création de lien de
 * paiement, règle de commission, and création de boutique. Currencies are
 * fully independent balances (no conversion), so this choice is never
 * cosmetic — it determines which balance/rule gets checked server-side.
 */
export function CurrencySelector({ value, onChange, className, variant = 'default' }: CurrencySelectorProps) {
  if (variant === 'pill') {
    return (
      <div className={cn('inline-flex rounded-full bg-white/15 p-0.5', className)}>
        {CURRENCIES.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => onChange(c.value)}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-bold transition-colors',
              value === c.value ? 'bg-white text-primary' : 'text-primary-foreground/80 hover:text-primary-foreground',
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={cn('grid grid-cols-2 gap-2', className)}>
      {CURRENCIES.map((c) => (
        <button
          key={c.value}
          type="button"
          onClick={() => onChange(c.value)}
          className={cn(
            'rounded-xl border-2 px-4 py-2.5 text-sm font-semibold transition-colors',
            value === c.value
              ? 'border-primary bg-primary/5 text-primary'
              : 'border-input text-muted-foreground hover:bg-accent',
          )}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
