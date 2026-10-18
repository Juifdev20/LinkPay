import { toNationalDigits, groupNational } from '@/lib/mobile-money';
import { cn } from '@/lib/utils';

/**
 * A DRC phone number: the 🇨🇩 flag and +243 are fixed on the left, the person
 * types the 9 digits (81…, 82…, 99…) — a leading 0 or a pasted "+243 …" is
 * absorbed. `value` / `onChange` carry the 9 national digits only; the API
 * gets "+243" + digits (toApiPhone).
 */
export function PhoneInput({
  id,
  value,
  onChange,
  autoFocus,
  invalid,
  className,
}: {
  id?: string;
  value: string;
  onChange: (digits: string) => void;
  autoFocus?: boolean;
  invalid?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex h-11 w-full items-stretch overflow-hidden rounded-xl border bg-background text-foreground focus-within:ring-2 focus-within:ring-ring',
        invalid ? 'border-destructive' : 'border-input',
        className,
      )}
    >
      <span className="flex select-none items-center gap-1.5 border-r border-input bg-muted/50 px-3 text-sm font-semibold text-foreground" aria-hidden>
        <span className="text-base leading-none">🇨🇩</span> +243
      </span>
      <input
        id={id}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        placeholder="812 345 678"
        aria-label="Numéro de téléphone (9 chiffres après +243)"
        autoFocus={autoFocus}
        value={groupNational(value)}
        onChange={(e) => onChange(toNationalDigits(e.target.value))}
        className="min-w-0 flex-1 bg-transparent px-3 text-base tracking-wide outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

/** 9 digits, not starting with 0: what the API accepts. */
export const isCompletePhone = (digits: string) => /^[1-9]\d{8}$/.test(digits);
