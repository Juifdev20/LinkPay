import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils';

interface BalanceCardProps {
  balanceCents: number;
  currency?: string;
  label?: string;
  /** e.g. the wallet's LinkPay number — shown under the label */
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
  /** Shows an eye toggle to hide/reveal the amount — purely a display
   * preference (local state only), never a security boundary. */
  maskable?: boolean;
}

export function BalanceCard({
  balanceCents,
  currency = 'CDF',
  label = 'Solde disponible',
  subtitle,
  actions,
  className,
  maskable = false,
}: BalanceCardProps) {
  const [hidden, setHidden] = useState(false);

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
        {maskable && (
          <button
            type="button"
            onClick={() => setHidden((h) => !h)}
            aria-label={hidden ? 'Afficher le solde' : 'Masquer le solde'}
            className="flex-shrink-0 text-primary-foreground/80 hover:text-primary-foreground transition-colors"
          >
            {hidden ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
          </button>
        )}
      </div>
      <p className="text-3xl font-bold mt-2 tracking-tight">
        {hidden ? `•••••• ${currency}` : formatCurrency(balanceCents, currency)}
      </p>
      {actions && <div className="mt-4 flex gap-3">{actions}</div>}
    </div>
  );
}
