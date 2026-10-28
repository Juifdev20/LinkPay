import { cn, formatCurrency } from '@/lib/utils';
import { amountToCents, cleanAmount, showAmount } from '@/lib/amount';

type Currency = 'CDF' | 'USD';

const PRESETS: Record<Currency, number[]> = {
  CDF: [5000, 10000, 25000, 50000],
  USD: [5, 10, 25, 50],
};

const CURRENCY_NAME: Record<Currency, string> = { CDF: 'Franc congolais', USD: 'Dollar américain' };

interface AmountEntryProps {
  /** Digits only ("25000"); with `allowDecimals`, a dot for the cents ("12.5"). Units, never cents. */
  value: string;
  onChange: (value: string) => void;
  currency: Currency;
  onCurrencyChange?: (c: Currency) => void;
  /** Current balance in cents of the chosen currency: shows "after this top-up" under the amount. */
  balanceCents?: number;
  error?: string;
  autoFocus?: boolean;
  /** Small title over the amount. */
  label?: string;
  /** The currency is chosen elsewhere on the screen (the exchange's « Je donne » box): no switch here. */
  hideCurrencySwitch?: boolean;
  /** Cents allowed (dollars moved inside ScanLinkPay). Mobile Money and cards take whole units only: leave it off. */
  allowDecimals?: boolean;
  /** Quick amounts; `false` hides them. */
  presets?: number[] | false;
  /** The line under the balance once an amount is typed. `null` hides it (it only makes sense for a top-up). */
  afterLabel?: string | null;
  /** Shows a « Tout » shortcut next to the balance (puts the whole balance in the field). */
  onMax?: () => void;
}

/**
 * The amount screen of a payment: currency switch, the amount in large type, quick amounts, and what the balance will
 * be afterwards. Opens the phone's NUMERIC keyboard (never the full one). Whole units by default: the payment
 * providers do not take cents; `allowDecimals` is for dollars moved inside ScanLinkPay.
 */
export function AmountEntry({
  value, onChange, currency, onCurrencyChange, balanceCents, error, autoFocus, label = 'Montant à recharger',
  hideCurrencySwitch, allowDecimals, presets, afterLabel = 'Solde après recharge', onMax,
}: AmountEntryProps) {
  const shown = showAmount(value);
  const cents = amountToCents(value);
  const quick = presets === false ? [] : presets ?? PRESETS[currency];

  return (
    <div className="space-y-5">
      {!hideCurrencySwitch && (
        <div role="radiogroup" aria-label="Devise" className="grid grid-cols-2 gap-1 rounded-2xl bg-secondary p-1">
          {(['CDF', 'USD'] as Currency[]).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={currency === c}
              onClick={() => { onCurrencyChange?.(c); onChange(''); }}
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
      )}

      <label htmlFor="amount-entry" className="block cursor-text rounded-3xl bg-secondary/60 px-4 py-7 text-center ring-primary/30 transition-shadow focus-within:ring-4">
        <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="flex items-baseline justify-center gap-1">
          <input
            id="amount-entry"
            inputMode={allowDecimals ? 'decimal' : 'numeric'}
            enterKeyHint="done"
            autoComplete="off"
            autoFocus={autoFocus}
            placeholder="0"
            value={shown}
            onChange={(e) => onChange(cleanAmount(e.target.value, !!allowDecimals))}
            style={{ width: `${Math.max(shown.length, 1) + 0.25}ch` }}
            className="max-w-full bg-transparent text-center text-5xl font-bold tabular-nums text-foreground outline-none placeholder:text-muted-foreground/40"
          />
          <span className="text-lg font-semibold text-muted-foreground">{currency}</span>
        </span>
        {error && <span role="alert" className="mt-3 block text-sm font-medium text-destructive">{error}</span>}
      </label>

      {quick.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {quick.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onChange(String(p))}
              className={cn(
                'rounded-xl border-2 py-2.5 text-sm font-semibold tabular-nums transition-colors',
                cents === p * 100 ? 'border-primary bg-primary/5 text-primary' : 'border-border text-foreground hover:border-primary/40 hover:bg-primary/5',
              )}
            >
              {showAmount(String(p))}
            </button>
          ))}
        </div>
      )}

      {balanceCents !== undefined && (
        <div className="space-y-2 rounded-2xl border border-border px-4 py-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Solde actuel</span>
            <span className="flex items-center gap-3">
              <span className="font-semibold tabular-nums text-foreground">{formatCurrency(balanceCents, currency)}</span>
              {onMax && balanceCents > 0 && (
                <button type="button" onClick={onMax} className="rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary hover:bg-primary/15">
                  Tout
                </button>
              )}
            </span>
          </div>
          {afterLabel && cents > 0 && (
            <div className="flex items-center justify-between border-t border-border pt-2">
              <span className="text-muted-foreground">{afterLabel}</span>
              <span className="font-bold tabular-nums text-success">{formatCurrency(balanceCents + cents, currency)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
