import { cn, formatCurrency } from '@/lib/utils';

type Currency = 'CDF' | 'USD';

const PRESETS: Record<Currency, number[]> = {
  CDF: [5000, 10000, 25000, 50000],
  USD: [5, 10, 25, 50],
};

const CURRENCY_NAME: Record<Currency, string> = { CDF: 'Franc congolais', USD: 'Dollar américain' };

/** "25000" → "25 000" */
const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

interface AmountEntryProps {
  /** Whole units, digits only ("25000"). */
  value: string;
  onChange: (digits: string) => void;
  currency: Currency;
  onCurrencyChange: (c: Currency) => void;
  /** Current balance in cents of the chosen currency: shows "after this top-up" under the amount. */
  balanceCents?: number;
  error?: string;
  autoFocus?: boolean;
}

/**
 * The amount screen of a payment: currency switch, the amount in large type, quick amounts, and what the balance will
 * be afterwards. Whole units only: the payment providers do not take cents.
 */
export function AmountEntry({ value, onChange, currency, onCurrencyChange, balanceCents, error, autoFocus }: AmountEntryProps) {
  const shown = group(value);
  const units = Number(value || 0);

  return (
    <div className="space-y-5">
      <div role="radiogroup" aria-label="Devise" className="grid grid-cols-2 gap-1 rounded-2xl bg-secondary p-1">
        {(['CDF', 'USD'] as Currency[]).map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={currency === c}
            onClick={() => { onCurrencyChange(c); onChange(''); }}
            className={cn(
              'rounded-xl px-3 py-2 text-center transition-all',
              currency === c ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="block text-sm font-bold">{c}</span>
            <span className="block text-[11px] leading-tight opacity-80">{CURRENCY_NAME[c]}</span>
          </button>
        ))}
      </div>

      <label htmlFor="amount-entry" className="block cursor-text rounded-3xl bg-secondary/60 px-4 py-7 text-center ring-primary/30 transition-shadow focus-within:ring-4">
        <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Montant à recharger</span>
        <span className="flex items-baseline justify-center gap-1">
          <input
            id="amount-entry"
            inputMode="numeric"
            autoComplete="off"
            autoFocus={autoFocus}
            placeholder="0"
            value={shown}
            onChange={(e) => onChange(e.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 9))}
            style={{ width: `${Math.max(shown.length, 1) + 0.25}ch` }}
            className="max-w-full bg-transparent text-center text-5xl font-bold tabular-nums text-foreground outline-none placeholder:text-muted-foreground/40"
          />
          <span className="text-lg font-semibold text-muted-foreground">{currency}</span>
        </span>
        {error && <span role="alert" className="mt-3 block text-sm font-medium text-destructive">{error}</span>}
      </label>

      <div className="grid grid-cols-4 gap-2">
        {PRESETS[currency].map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(String(p))}
            className={cn(
              'rounded-xl border-2 py-2.5 text-sm font-semibold tabular-nums transition-colors',
              units === p ? 'border-primary bg-primary/5 text-primary' : 'border-border text-foreground hover:border-primary/40 hover:bg-primary/5',
            )}
          >
            {group(String(p))}
          </button>
        ))}
      </div>

      {balanceCents !== undefined && (
        <div className="space-y-2 rounded-2xl border border-border px-4 py-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Solde actuel</span>
            <span className="font-semibold tabular-nums text-foreground">{formatCurrency(balanceCents, currency)}</span>
          </div>
          {units > 0 && (
            <div className="flex items-center justify-between border-t border-border pt-2">
              <span className="text-muted-foreground">Solde après recharge</span>
              <span className="font-bold tabular-nums text-success">{formatCurrency(balanceCents + units * 100, currency)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
