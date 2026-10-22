import { useState, type ReactNode } from 'react';
import { Check, X, Loader2, ShieldCheck, Clock, Copy, CheckCheck, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ResultTone = 'success' | 'error' | 'pending' | 'waiting' | 'info';

export interface ResultRow {
  label: string;
  value: ReactNode;
  /** Monospace + copy button (references). */
  copy?: string;
  className?: string;
}

const TONES: Record<ResultTone, { ring: string; core: string; icon: LucideIcon; spin?: boolean }> = {
  success: { ring: 'bg-success/10', core: 'bg-success shadow-[0_10px_30px_-8px_hsl(var(--success)/0.6)]', icon: Check },
  error: { ring: 'bg-destructive/10', core: 'bg-destructive shadow-[0_10px_30px_-8px_hsl(var(--destructive)/0.6)]', icon: X },
  pending: { ring: 'bg-primary/10', core: 'bg-brand-gradient shadow-brand', icon: Loader2, spin: true },
  waiting: { ring: 'bg-warning/10', core: 'bg-warning shadow-[0_10px_30px_-8px_hsl(var(--warning)/0.6)]', icon: Clock },
  info: { ring: 'bg-primary/10', core: 'bg-brand-gradient shadow-brand', icon: ShieldCheck },
};

/**
 * The outcome of an operation, the same everywhere (payment, top-up, send, Pro, links): a large round status icon,
 * the title, the amount in big type, a receipt-like box of details, then the actions.
 */
export function ResultView({
  tone,
  title,
  message,
  amount,
  rows = [],
  icon,
  children,
  className,
}: {
  tone: ResultTone;
  title: string;
  message?: ReactNode;
  /** Already formatted ("10 000,00 CDF"). */
  amount?: string;
  rows?: ResultRow[];
  /** Replaces the tone's icon. */
  icon?: LucideIcon;
  /** Buttons / links. */
  children?: ReactNode;
  className?: string;
}) {
  const t = TONES[tone];
  const Icon = icon ?? t.icon;
  return (
    <div className={cn('flex flex-col items-center text-center', className)}>
      <div className="relative h-24 w-24 animate-in zoom-in-50 fade-in duration-500">
        <span className={cn('absolute inset-0 rounded-full', t.ring)} />
        <span className={cn('absolute inset-2.5 rounded-full', t.ring)} />
        <span className={cn('absolute inset-5 flex items-center justify-center rounded-full text-white', t.core)}>
          <Icon className={cn('h-7 w-7', t.spin && 'animate-spin')} strokeWidth={2.75} />
        </span>
      </div>

      <h1 className="mt-5 text-2xl font-bold tracking-tight text-foreground">{title}</h1>
      {amount && <p className="mt-2 text-[2.25rem] font-extrabold leading-tight tracking-tight tabular-nums text-foreground">{amount}</p>}
      {message && <div className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{message}</div>}

      {rows.length > 0 && (
        <dl className="mt-6 w-full divide-y divide-dashed divide-border rounded-2xl border border-border bg-muted/40 px-4 text-sm">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-4 py-3">
              <dt className="shrink-0 text-muted-foreground">{r.label}</dt>
              <dd className={cn('flex min-w-0 items-center gap-1.5 font-semibold text-foreground', r.className)}>
                {r.copy ? <CopyValue text={r.copy} /> : r.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {children && <div className="mt-6 flex w-full flex-col gap-2.5">{children}</div>}
    </div>
  );
}

function CopyValue({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); } catch { /* the value is on screen */ }
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-0.5 font-mono text-xs hover:bg-accent"
      aria-label="Copier la référence"
    >
      <span className="truncate">{text}</span>
      {done ? <CheckCheck className="h-3.5 w-3.5 shrink-0 text-success" /> : <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
    </button>
  );
}

/** The card a ResultView sits in, on pages of the signed-in app. */
export function ResultCard({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-6 md:py-10">
      <div className="rounded-3xl border border-border bg-card px-5 py-8 shadow-soft sm:px-8">{children}</div>
    </div>
  );
}
