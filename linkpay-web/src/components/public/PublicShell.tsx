import type { ReactNode } from 'react';
import { ArrowLeft, Lock, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import logoSrc from '@/assets/logo.png';

/**
 * Frame of the pages people reach without the app (payment link, pay by number, payment result, card): a gradient
 * band with the logo and « Paiement sécurisé », the content in cards over it, and a reassurance line at the bottom.
 * Same look on phone and computer; the content column stays phone-width so the form reads the same everywhere.
 */
export function PublicShell({ children, onBack, className }: { children: ReactNode; onBack?: () => void; className?: string }) {
  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-x-hidden bg-background">
      <div className="absolute inset-x-0 top-0 h-64 overflow-hidden bg-brand-gradient md:h-80" aria-hidden>
        <span className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-white/10" />
        <span className="absolute -left-16 top-24 h-48 w-48 rounded-full bg-white/[0.07]" />
        <svg className="absolute bottom-0 left-0 h-12 w-full" viewBox="0 0 390 48" preserveAspectRatio="none">
          <path d="M0 22 C70 4 130 4 195 20 C262 36 322 38 390 16 L390 48 L0 48 Z" className="fill-background" />
        </svg>
      </div>

      <header
        className="relative z-10 mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 pt-4 md:px-8 md:pt-6"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Retour"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/25"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <img src={logoSrc} alt="" className="h-9 w-9 rounded-xl object-cover shadow-md ring-2 ring-white/20" />
          <span className="truncate text-lg font-extrabold tracking-tight text-white">
            ScanLink<span className="text-sky-300">Pay</span>
          </span>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">
          <ShieldCheck className="h-4 w-4" /> Paiement sécurisé
        </span>
      </header>

      <main className={cn('relative z-10 mx-auto w-full max-w-md flex-1 space-y-4 px-4 pb-6 pt-6 md:pt-12', className)}>{children}</main>

      <footer
        className="relative z-10 flex items-center justify-center gap-1.5 px-4 pt-2 text-center text-xs text-muted-foreground"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 20px)' }}
      >
        <Lock className="h-3.5 w-3.5" /> Connexion chiffrée · ScanLinkPay
      </footer>
    </div>
  );
}

/** A white (dark: night) card of the public pages. */
export function PublicCard({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('rounded-3xl border border-border bg-card p-5 shadow-soft sm:p-6', className)}>{children}</section>;
}
