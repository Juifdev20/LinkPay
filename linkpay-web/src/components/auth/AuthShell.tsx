import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Zap, MonitorSmartphone, Wifi } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { cn } from '@/lib/utils';
import logoSrc from '@/assets/logo.png';

interface AuthShellProps {
  /** Card title and subtitle — the same card on phone and computer. */
  /** Without a title the card has no header (e.g. a result inside). */
  title?: string;
  subtitle?: string;
  /** Computer, left panel: "Bienvenue sur" / "Rejoignez". */
  headline: string;
  /** Computer, top right: "Déjà un compte ?" + link. */
  switchPrompt?: string;
  switchLabel?: string;
  switchTo?: string;
  children: ReactNode;
}

const FEATURES = [
  { icon: ShieldCheck, title: 'Paiements sécurisés', text: 'Vos transactions sont protégées' },
  { icon: Zap, title: 'Transferts rapides', text: 'Envoyez et recevez en quelques secondes' },
  { icon: MonitorSmartphone, title: 'Disponible partout', text: 'Sur mobile et sur ordinateur' },
];

/**
 * Frame of the login and register pages (maquette 2026).
 * Phone: gradient header with the logo and a wave edge, the form card overlapping it, faint waves at the bottom.
 * Computer: brand panel on the left (headline, three features, phone + card illustration), the same card on the right.
 * The page scrolls as a whole and the card is anchored to the top on phones: no re-centering when the keyboard opens.
 */
export function AuthShell({ title, subtitle, headline, switchPrompt, switchLabel, switchTo, children }: AuthShellProps) {
  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden bg-background md:grid md:h-[100dvh] md:overflow-hidden md:grid-cols-2 lg:grid-cols-[1.05fr_1fr]">
      {/* ── Phone header ── */}
      <header className="relative bg-brand-gradient safe-area-top md:hidden">
        <div className="flex flex-col items-center px-6 pb-[4.5rem] pt-9 text-center">
          <img src={logoSrc} alt="" className="h-16 w-16 rounded-2xl bg-white object-cover shadow-lg ring-4 ring-white/20" />
          <p className="mt-3 text-[1.75rem] font-extrabold leading-none tracking-tight text-white">
            ScanLink<span className="text-sky-300">Pay</span>
          </p>
          <p className="mt-2 text-sm font-medium text-white/85">Payez · Recevez · Simplifiez</p>
        </div>
        <svg className="absolute bottom-0 left-0 h-12 w-full" viewBox="0 0 390 48" preserveAspectRatio="none" aria-hidden>
          <path d="M0 22 C70 4 130 4 195 20 C262 36 322 38 390 16 L390 48 L0 48 Z" className="fill-background" />
        </svg>
      </header>

      {/* ── Computer brand panel ── */}
      <aside className="relative hidden overflow-hidden border-r border-border bg-card md:flex md:h-full md:flex-col md:px-10 md:py-8 lg:px-16">
        <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-secondary/10 blur-3xl" />
        <Logo size="md" className="relative" />

        <div className="relative my-auto pt-6">
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-foreground lg:text-5xl">
            {headline}
            <br />
            <span className="text-brand-gradient">ScanLinkPay</span>
          </h1>
          <p className="mt-4 max-w-md text-base text-muted-foreground lg:text-lg">
            Une solution simple, rapide et sécurisée pour tous vos paiements.
          </p>

          <ul className="mt-8 space-y-5">
            {FEATURES.map(({ icon: Icon, title: t, text }) => (
              <li key={t} className="flex items-center gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Icon className="h-6 w-6" />
                </span>
                <span>
                  <span className="block font-semibold text-foreground">{t}</span>
                  <span className="block text-sm text-muted-foreground">{text}</span>
                </span>
              </li>
            ))}
          </ul>

          <PhoneIllustration />
        </div>
      </aside>

      {/* ── Form (both) ── */}
      {/* Computer: the column never scrolls; the card fits the screen, its title stays put and only the fields scroll inside it. */}
      <main className="relative z-10 flex flex-col px-4 pb-10 md:h-full md:min-h-0 md:px-10 md:py-8">
        <p className="hidden min-h-5 shrink-0 justify-end text-sm text-muted-foreground md:flex">
          {switchTo && (
            <>
              {switchPrompt}&nbsp;
              <Link to={switchTo} className="font-semibold text-primary hover:underline">{switchLabel}</Link>
            </>
          )}
        </p>
        <div className="-mt-12 w-full md:mt-0 md:flex md:min-h-0 md:flex-1 md:items-center md:pt-6">
          <div className="mx-auto flex w-full max-w-md flex-col rounded-3xl border border-border bg-card shadow-soft md:max-h-full md:shadow-xl">
            {title && (
              <div className="shrink-0 px-5 pt-5 sm:px-7 sm:pt-7 md:border-b md:border-border/60 md:px-8 md:pb-5 md:pt-8">
                <h2 className="text-2xl font-bold tracking-tight text-foreground md:text-[1.75rem]">{title}</h2>
                {subtitle && <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{subtitle}</p>}
              </div>
            )}
            <div className={cn('px-5 pb-5 sm:px-7 sm:pb-7 md:min-h-0 md:overflow-y-auto md:px-8 md:pb-8 [scrollbar-gutter:stable]', title ? 'mt-6 md:mt-0 md:pt-5' : 'pt-7 md:pt-8')}>{children}</div>
          </div>
        </div>
      </main>

      {/* Faint waves at the bottom of the phone screen */}
      <svg className="pointer-events-none absolute bottom-0 left-0 h-28 w-full md:hidden" viewBox="0 0 390 112" preserveAspectRatio="none" aria-hidden>
        <path d="M0 70 C80 40 150 100 230 70 C300 44 350 56 390 66 L390 112 L0 112 Z" className="fill-primary/[0.06]" />
        <path d="M0 92 C90 66 170 112 250 88 C320 68 360 80 390 86 L390 112 L0 112 Z" className="fill-secondary/[0.07]" />
      </svg>
    </div>
  );
}

/** Phone with the logo and a payment card, drawn in HTML so it follows the theme. */
function PhoneIllustration() {
  return (
    <div className="relative mt-8 hidden h-48 lg:block [@media(max-height:760px)]:hidden" aria-hidden>
      <div className="absolute left-6 top-0 h-48 w-28 rounded-[1.6rem] border-[5px] border-foreground/85 bg-background shadow-2xl">
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-foreground/20" />
        <div className="mt-8 flex flex-col items-center">
          <img src={logoSrc} alt="" className="h-11 w-11 rounded-xl object-cover shadow-md" />
          <p className="mt-2 text-xs font-extrabold tracking-tight text-foreground">
            ScanLink<span className="text-brand-sky">Pay</span>
          </p>
          <div className="mt-6 h-1.5 w-16 rounded-full bg-primary/20" />
          <div className="mt-2 h-1.5 w-10 rounded-full bg-primary/10" />
        </div>
      </div>
      <div className="absolute left-28 top-16 h-28 w-48 -rotate-6 rounded-2xl bg-brand-gradient p-4 text-white shadow-brand">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold">ScanLinkPay</span>
          <Wifi className="h-4 w-4 rotate-90 opacity-80" />
        </div>
        <div className="mt-3 h-6 w-9 rounded-md bg-white/30" />
        <p className="mt-3 font-mono text-sm tracking-[0.2em] opacity-90">•••• 2026</p>
      </div>
    </div>
  );
}
