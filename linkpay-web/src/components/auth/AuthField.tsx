import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Eye, EyeOff, type LucideIcon } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * One field of the login / register cards: label, input with its icon, and a
 * message line under it whose height is always reserved, so a hint turning
 * into an error (or appearing) never pushes the rest of the form while the
 * person types. Inputs are 16px so phones do not zoom in on focus.
 */
export function AuthField({
  id,
  label,
  icon: Icon,
  error,
  hint,
  password,
  children,
  className,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: ReactNode;
  icon?: LucideIcon;
  error?: string;
  hint?: ReactNode;
  /** Adds the show / hide button. */
  password?: boolean;
  /** Replaces the input (e.g. the phone number field). */
  children?: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className={cn('mb-2.5', className)}>
      <Label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-foreground">{label}</Label>
      {children ?? (
        <div className="relative">
          {Icon && <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />}
          <input
            id={id}
            {...input}
            type={password ? (shown ? 'text' : 'password') : input.type}
            aria-invalid={!!error || undefined}
            className={cn(
              'flex h-12 w-full rounded-xl border bg-background text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground placeholder:font-normal focus:border-primary focus:ring-2 focus:ring-primary/20',
              Icon ? 'pl-11' : 'pl-4',
              password ? 'pr-11' : 'pr-4',
              error ? 'border-destructive' : 'border-input',
            )}
          />
          {password && (
            <button
              type="button"
              onClick={() => setShown((v) => !v)}
              aria-label={shown ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
            >
              {shown ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
            </button>
          )}
        </div>
      )}
      <FieldMessage error={error} hint={hint} />
    </div>
  );
}

/** The reserved one-line slot under a field. */
export function FieldMessage({ error, hint }: { error?: string; hint?: ReactNode }) {
  return (
    <p className={cn('mt-1 min-h-[1.125rem] truncate text-xs leading-[1.125rem]', error ? 'text-destructive' : 'text-muted-foreground')}>
      {error || hint}
    </p>
  );
}
