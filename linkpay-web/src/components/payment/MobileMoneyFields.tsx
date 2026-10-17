import { useId } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MOBILE_MONEY_OPERATORS, checkNumber, groupNational, operatorById, toNationalDigits } from '@/lib/mobile-money';

interface MobileMoneyFieldsProps {
  operator: string;
  onOperatorChange: (id: string) => void;
  /** The 9 national digits ("828497218"), see toNationalDigits. */
  phone: string;
  onPhoneChange: (digits: string) => void;
  autoFocusPhone?: boolean;
  /** What the request will do, under the field. */
  hint?: string;
}

/**
 * Choice of the Mobile Money operator (logo cards) and of the number, the same on every payment screen. The number is
 * checked against the chosen operator as soon as its prefix is typed: an Airtel number cannot be sent as M-Pesa, the
 * confirmation request would reach another network than the one on screen.
 */
export function MobileMoneyFields({ operator, onOperatorChange, phone, onPhoneChange, autoFocusPhone, hint }: MobileMoneyFieldsProps) {
  const id = useId();
  const chosen = operatorById(operator) ?? MOBILE_MONEY_OPERATORS[0];
  const check = checkNumber(chosen.id, phone);
  const bad = check.state === 'mismatch' || check.state === 'bad_start';

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-sm font-semibold text-foreground">Opérateur</p>
        <div role="radiogroup" aria-label="Opérateur Mobile Money" className="grid grid-cols-3 gap-2.5">
          {MOBILE_MONEY_OPERATORS.map((o) => {
            const selected = o.id === chosen.id;
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onOperatorChange(o.id)}
                className={cn(
                  'relative flex flex-col items-center gap-2 rounded-2xl border-2 px-2 pb-2.5 pt-3 transition-all',
                  selected ? 'border-primary bg-primary/5 shadow-sm' : 'border-border bg-card hover:border-primary/40',
                )}
              >
                <img src={o.logo} alt="" className="h-12 w-12 rounded-xl object-cover shadow-sm" />
                <span className={cn('text-xs font-semibold', selected ? 'text-primary' : 'text-foreground')}>{o.short}</span>
                {selected && (
                  <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label htmlFor={id} className="mb-2 block text-sm font-semibold text-foreground">Numéro {chosen.short}</label>
        <div
          className={cn(
            'flex items-stretch overflow-hidden rounded-2xl border-2 bg-card transition-colors',
            bad ? 'border-destructive' : 'border-border focus-within:border-primary',
          )}
        >
          <div className="flex items-center gap-2 border-r border-border bg-secondary/70 px-3.5">
            <img src={chosen.logo} alt="" className="h-6 w-6 rounded-md object-cover" />
            <span className="text-[15px] font-semibold tabular-nums text-foreground">+243</span>
          </div>
          <input
            id={id}
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            autoFocus={autoFocusPhone}
            placeholder={chosen.example}
            value={groupNational(phone)}
            onChange={(e) => onPhoneChange(toNationalDigits(e.target.value))}
            aria-invalid={bad}
            className="min-w-0 flex-1 bg-transparent px-3.5 py-3.5 text-lg font-semibold tabular-nums tracking-wide text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground/50"
          />
          {check.state === 'ok' && !check.unknownPrefix && (
            <span className="flex items-center pr-3.5 text-success"><Check className="h-5 w-5" strokeWidth={3} /></span>
          )}
        </div>

        {check.state === 'mismatch' && (
          <div role="alert" className="mt-2.5 rounded-xl bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
            <p className="font-medium">{check.message}</p>
            {check.detected && (
              <button type="button" onClick={() => onOperatorChange(check.detected!)} className="mt-1.5 font-bold underline underline-offset-2">
                Choisir {operatorById(check.detected)?.short}
              </button>
            )}
          </div>
        )}
        {check.state === 'bad_start' && <p role="alert" className="mt-2.5 text-sm font-medium text-destructive">{check.message}</p>}
        {check.state === 'ok' && check.unknownPrefix && (
          <p className="mt-2.5 text-sm text-warning">Opérateur de ce numéro non reconnu : vérifiez-le bien avant de continuer.</p>
        )}
        {!bad && !(check.state === 'ok' && check.unknownPrefix) && (
          <p className="mt-2.5 text-xs text-muted-foreground">{hint ?? 'Une demande de confirmation sera envoyée à ce numéro.'}</p>
        )}
      </div>
    </div>
  );
}
