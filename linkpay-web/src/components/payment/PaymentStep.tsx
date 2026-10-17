import { ArrowLeft, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PaymentStepProps {
  title: string;
  subtitle?: string;
  /** Shows the round back arrow. */
  onBack?: () => void;
  error?: string;
  children: React.ReactNode;
  /** Pinned at the bottom of the sheet, always reachable: the main button. */
  footer?: React.ReactNode;
  className?: string;
}

/**
 * One step of a payment flow, inside the FormSheet: back arrow, title, content, and the main button pinned at the
 * bottom (it stays visible when the keyboard is open or the content is long). Same frame on every payment screen.
 */
export function PaymentStep({ title, subtitle, onBack, error, children, footer, className }: PaymentStepProps) {
  return (
    <div className={cn('mx-auto flex w-full max-w-md flex-col px-5 pb-4 pt-3 md:px-7 md:pt-7', className)}>
      <header className="flex items-start gap-3 pr-9">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Retour"
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground transition-colors hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0">
          <h2 className="text-xl font-bold leading-tight text-foreground">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </header>

      {error && (
        <div role="alert" className="mt-4 flex items-start gap-2.5 rounded-xl border border-destructive/20 bg-destructive/10 px-3.5 py-3 text-sm font-medium text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-6 space-y-6">{children}</div>

      {footer && (
        <div className="sticky bottom-0 -mx-5 mt-6 bg-card/95 px-5 pb-1 pt-3 backdrop-blur md:-mx-7 md:px-7">{footer}</div>
      )}
    </div>
  );
}
