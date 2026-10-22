import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils';
import { CurrencySelector } from '@/components/CurrencySelector';

interface BalanceCardProps {
  /** Independent per-currency balances — no conversion, each is its own real number. */
  balances: { CDF: number; USD: number };
  label?: string;
  /** e.g. the wallet's ScanLinkPay number — shown under the label */
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
        'relative overflow-hidden rounded-3xl bg-brand-gradient p-5 text-primary-foreground shadow-brand',
        className,
      )}
    >
      {/* Light shapes mixed into the gradient, as in the design. */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 400 240" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="bc-wave" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.18" />
            <stop offset="1" stopColor="#7cc8ff" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        <circle cx="360" cy="-10" r="120" fill="#ffffff" fillOpacity="0.08" />
        <circle cx="395" cy="40" r="70" fill="#7cc8ff" fillOpacity="0.16" />
        <path d="M0 175 C 90 135, 170 215, 260 170 S 380 120, 400 145 L 400 240 L 0 240 Z" fill="url(#bc-wave)" />
        <path d="M0 205 C 110 170, 200 240, 300 200 S 380 175, 400 190 L 400 240 L 0 240 Z" fill="#ffffff" fillOpacity="0.06" />
      </svg>

      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-primary-foreground/90">{label}</p>
            {subtitle && <p className="text-[11px] text-primary-foreground/70 mt-0.5 truncate tracking-wide">{subtitle}</p>}
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
                {hidden ? <EyeOff className="w-[18px] h-[18px]" /> : <Eye className="w-[18px] h-[18px]" />}
              </button>
            )}
          </div>
        </div>
        <p className="text-[30px] leading-tight font-extrabold mt-3 tracking-tight">
          {hidden ? `•••••• ${activeCurrency}` : formatCurrency(balances[activeCurrency], activeCurrency)}
        </p>
        {actions && <div className="mt-5 flex gap-3">{actions}</div>}
      </div>
    </div>
  );
}
