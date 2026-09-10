import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils';
import { CurrencySelector } from '@/components/CurrencySelector';

interface BalanceCardProps {
  /** Independent per-currency balances — no conversion, each is its own real number. */
  balances: { CDF: number; USD: number };
  label?: string;
  /** e.g. the wallet's LinkPay number — shown under the label */
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
  /** Shows an eye toggle to hide/reveal the amount — purely a display
   * preference (local state only), never a security boundary. */
  maskable?: boolean;
  /** Called whenever the CDF/USD toggle changes, so the parent can keep
   * currency-scoped actions (WalletActions) in sync. */
  onCurrencyChange?: (currency: 'CDF' | 'USD') => void;
}

export function BalanceCard({
  balances,
  label = 'Solde disponible',
  subtitle,
  actions,
  className,
  maskable = false,
  onCurrencyChange,
}: BalanceCardProps) {
  const [hidden, setHidden] = useState(false);
  const [activeCurrency, setActiveCurrency] = useState<'CDF' | 'USD'>('CDF');

  const handleCurrencyChange = (currency: 'CDF' | 'USD') => {
    setActiveCurrency(currency);
    onCurrencyChange?.(currency);
  };

  return (
    <div
      className={cn(
        'rounded-2xl bg-gradient-to-br from-primary to-indigo-600 p-6 text-primary-foreground shadow-lg shadow-primary/20',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-primary-foreground/80">{label}</p>
          {subtitle && <p className="text-xs text-primary-foreground/60 mt-0.5 truncate">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <CurrencySelector value={activeCurrency} onChange={handleCurrencyChange} variant="pill" />
          {maskable && (
            <button
              type="button"
              onClick={() => setHidden((h) => !h)}
              aria-label={hidden ? 'Afficher le solde' : 'Masquer le solde'}
              className="text-primary-foreground/80 hover:text-primary-foreground transition-colors"
            >
              {hidden ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          )}
        </div>
      </div>
      <p className="text-3xl md:text-4xl font-bold mt-2 tracking-tight">
        {hidden ? `•••••• ${activeCurrency}` : formatCurrency(balances[activeCurrency], activeCurrency)}
      </p>
      {actions && <div className="mt-4 flex gap-3">{actions}</div>}
    </div>
  );
}
