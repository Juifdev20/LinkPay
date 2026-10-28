import { cleanAmount, showAmount } from '@/lib/amount';

interface AmountInputProps {
  /** Digits, and a dot for the cents ("12.5"): units, never cents. */
  value: string;
  onChange: (value: string) => void;
  /** Cents allowed (default). Whole units only for Mobile Money and cards. */
  allowDecimals?: boolean;
  id?: string;
  autoFocus?: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
}

/**
 * The bare amount field used by the compact money screens (Envoyer, Retirer): it opens the phone's NUMERIC keyboard
 * and keeps what is typed to a valid amount ("12 500,5", never "12,,5" or "1e3"). The look stays the caller's.
 * The full amount screen of a top-up is AmountEntry.
 */
export function AmountInput({ value, onChange, allowDecimals = true, id, autoFocus, required, placeholder = '0', className }: AmountInputProps) {
  return (
    <input
      id={id}
      inputMode={allowDecimals ? 'decimal' : 'numeric'}
      enterKeyHint="done"
      autoComplete="off"
      autoFocus={autoFocus}
      required={required}
      placeholder={placeholder}
      value={showAmount(value)}
      onChange={(e) => onChange(cleanAmount(e.target.value, allowDecimals))}
      className={className}
    />
  );
}
