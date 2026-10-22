import { useEffect, useRef } from 'react';
import { Delete, Loader2, ShieldCheck, KeyRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import logoSrc from '@/assets/logo.png';

/** "243891234218" → "•••••••••218": all but the last three digits hidden. */
export function maskPhone(phone?: string | null): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length > 3 ? `${'•'.repeat(digits.length - 3)}${digits.slice(-3)}` : '';
}

/** "jean.dupont@gmail.com" → "je•••••••••@gmail.com": for accounts that have no phone number. */
export function maskEmail(email?: string | null): string {
  const [name, domain] = String(email ?? '').split('@');
  if (!name || !domain) return '';
  return `${name.slice(0, 2)}${'•'.repeat(Math.max(name.length - 2, 3))}@${domain}`;
}

/** The line shown under the field: the phone number if the account has one, else the e-mail address. */
export function identityNote(user?: { phone?: string | null; email?: string | null } | null): string | undefined {
  const phone = maskPhone(user?.phone);
  if (phone) return `Numéro de téléphone : ${phone}`;
  const email = maskEmail(user?.email);
  return email ? `Compte : ${email}` : undefined;
}

function Wordmark({ className }: { className?: string }) {
  return (
    <p className={cn('font-extrabold tracking-tight text-white md:text-foreground', className)}>
      ScanLink<span className="text-sky-300 md:text-primary">Pay</span>
    </p>
  );
}

/** Soft curves behind the card on a computer (blue on light, deeper blue on dark). */
function DesktopBackdrop() {
  return (
    <svg className="pointer-events-none fixed inset-0 hidden h-full w-full md:block" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id="pin-curve-a" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#1534b8" stopOpacity="0.28" />
          <stop offset="1" stopColor="#2f7bff" stopOpacity="0.04" />
        </linearGradient>
        <linearGradient id="pin-curve-b" x1="1" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#2f7bff" stopOpacity="0.3" />
          <stop offset="1" stopColor="#1534b8" stopOpacity="0.03" />
        </linearGradient>
      </defs>
      <path d="M0 900 L0 520 C180 560 360 700 470 900 Z" fill="url(#pin-curve-a)" className="dark:opacity-80" />
      <path d="M0 900 L0 640 C140 680 250 780 300 900 Z" fill="url(#pin-curve-a)" />
      <path d="M1440 0 L1440 820 C1250 760 1060 560 1010 0 Z" fill="url(#pin-curve-b)" className="dark:opacity-80" />
      <path d="M1440 0 L1440 520 C1320 470 1200 300 1180 0 Z" fill="url(#pin-curve-b)" />
    </svg>
  );
}

/**
 * Frame shared by every code screen (maquette « Écran d'authentification PIN »).
 * Phone: blue gradient page, logo + ScanLinkPay on top, the card, then the keypad panel at the bottom.
 * Computer: light (or deep blue) page with soft curves, a top bar (logo, « Sécurisé »), and everything in one centred card.
 * The same tree serves both: the md: classes turn the phone layout into the computer card.
 */
function PinFrame({ card, bottom }: { card: React.ReactNode; bottom?: React.ReactNode }) {
  return (
    // pointerEvents: auto — an open Radix dialog sets pointer-events:none on <body>, this screen must stay usable on top of it.
    <div
      data-pin-screen
      className="fixed inset-0 z-[100] flex flex-col overflow-y-auto bg-pin-gradient md:bg-none md:bg-[#f3f5fe] md:dark:bg-[#0a1240]"
      style={{ pointerEvents: 'auto' }}
    >
      <DesktopBackdrop />
      <header className="relative z-10 hidden shrink-0 items-center justify-between px-10 py-6 md:flex">
        <div className="flex items-center gap-2.5">
          <img src={logoSrc} alt="" className="h-9 w-9 rounded-xl object-cover shadow-sm" />
          <Wordmark className="text-lg" />
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-3 py-1.5 text-xs font-semibold text-foreground backdrop-blur dark:border-white/10 dark:bg-white/5">
          <ShieldCheck className="h-4 w-4 text-primary" /> Sécurisé
        </span>
      </header>

      <div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col md:justify-center md:px-4 md:pb-16">
        <div className="flex flex-1 flex-col md:mx-auto md:w-full md:max-w-[380px] md:flex-none md:rounded-[28px] md:border md:border-border md:bg-card md:px-7 md:py-7 md:shadow-[0_24px_60px_-20px_rgba(21,52,184,0.35)] md:dark:border-white/10 md:dark:bg-[#111a55]/80 md:dark:backdrop-blur-xl">
          <div className="flex flex-col items-center pb-5 pt-[clamp(20px,6vh,56px)] md:pb-4 md:pt-0">
            <div style={{ height: 'env(safe-area-inset-top)' }} className="md:hidden" />
            <img src={logoSrc} alt="ScanLinkPay" className="h-14 w-14 rounded-2xl object-cover shadow-lg ring-2 ring-white/25 md:h-12 md:w-12 md:ring-0" />
            <Wordmark className="mt-2 text-lg md:text-xl" />
          </div>

          <div className="mx-4 rounded-3xl bg-card px-5 py-5 text-center text-foreground shadow-xl dark:border dark:border-white/10 dark:bg-white/[0.06] dark:backdrop-blur md:mx-0 md:dark:backdrop-blur-none md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none md:dark:border-0 md:dark:bg-transparent">
            {card}
          </div>

          {bottom && (
            <>
              <div className="min-h-5 flex-1 md:hidden" />
              <div
                className="mt-0 rounded-t-[28px] bg-card px-4 pt-4 dark:bg-[#0d1548] md:mt-5 md:rounded-none md:bg-transparent md:p-0 md:dark:bg-transparent"
                style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 14px)' }}
              >
                {bottom}
              </div>
            </>
          )}
          {!bottom && <div className="h-6 md:hidden" />}
        </div>
      </div>
    </div>
  );
}

/**
 * A small window over a code screen (forgotten code → account password): the code screen stays visible underneath,
 * blurred and darkened. Closes with Échap or a tap outside the window.
 */
export function PinDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-[#0a1033]/45 p-4 backdrop-blur-md animate-in fade-in duration-200"
      style={{ pointerEvents: 'auto' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 text-center text-foreground shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-2 duration-200 dark:border-white/10 dark:bg-[#121b57]"
      >
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-brand">
          <KeyRound className="h-6 w-6" />
        </span>
        <p className="mt-4 text-lg font-semibold">{title}</p>
        <div className="mt-2">{children}</div>
      </div>
    </div>
  );
}

interface KeypadProps {
  /** e.g. "Entrez votre code PIN" */
  title: string;
  value: string;
  length: number;
  onChange: (value: string) => void;
  /** The "Entrée" key: available once the code is complete. */
  onEnter?: () => void;
  error?: string;
  /** Grey line under the dots, e.g. "Numéro de téléphone : •••••••••218". */
  note?: string;
  /** A few words under the title, when the screen needs explaining. */
  hint?: string;
  busy?: boolean;
  /** Links under the keypad ("Code PIN oublié ?"…). */
  footer?: React.ReactNode;
  /** Extra action above the footer (fingerprint). */
  extra?: React.ReactNode;
  /** A window is open over the screen: the keypad and the computer keyboard do nothing. */
  paused?: boolean;
}

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * The code entry screen: title, one dot per digit, the masked phone number, and a numeric keypad of rounded keys with
 * backspace, 0 and "Entrée". Typing on a computer keyboard works too. There is no text field at all, so on a phone the
 * system keyboard never opens over our keypad, and nothing moves while digits are typed.
 */
export function PinKeypadScreen({ title, value, length, onChange, onEnter, error, note, hint, busy, footer, extra, paused }: KeypadProps) {
  // Refs so the keyboard listener always sees the current value without being re-attached on every digit.
  const state = useRef({ value, busy: busy || paused, onChange, onEnter, length });
  state.current = { value, busy: busy || paused, onChange, onEnter, length };

  const press = (digit: string) => {
    const s = state.current;
    if (s.busy || s.value.length >= s.length) return;
    s.onChange(s.value + digit);
  };
  const back = () => {
    const s = state.current;
    if (!s.busy && s.value) s.onChange(s.value.slice(0, -1));
  };
  const enter = () => {
    const s = state.current;
    if (!s.busy && s.value.length === s.length) s.onEnter?.();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (state.current.busy) return;
      const t = e.target as HTMLElement | null;
      if (t && t.tagName === 'INPUT' && !(t as HTMLInputElement).readOnly) return; // a real text field has the keyboard
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); back(); }
      else if (e.key === 'Enter') { e.preventDefault(); enter(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const complete = value.length === length;
  const key = 'flex h-[clamp(46px,7.4vh,60px)] items-center justify-center rounded-2xl bg-muted text-foreground select-none touch-manipulation transition-[background-color,transform] active:scale-[0.96] hover:bg-accent disabled:opacity-60 dark:border dark:border-white/10 dark:bg-white/[0.07] dark:hover:bg-white/[0.12] md:h-12 md:rounded-xl';

  return (
    <PinFrame
      card={
        <>
          <p className="text-[17px] font-semibold md:text-base">{title}</p>
          {hint && <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">{hint}</p>}
          <div
            role="img"
            aria-label={`${value.length} chiffre${value.length > 1 ? 's' : ''} sur ${length}`}
            className="relative mx-auto mt-5 flex w-fit items-center justify-center gap-3.5 md:mt-4 md:rounded-full md:border md:border-border md:bg-muted/60 md:px-5 md:py-2.5 md:dark:border-white/10 md:dark:bg-white/[0.05]"
          >
            {Array.from({ length }, (_, i) => (
              <span
                key={i}
                className={cn(
                  'h-3.5 w-3.5 rounded-full transition-colors duration-150',
                  error ? 'bg-destructive' : i < value.length ? 'bg-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.18)]' : 'bg-[#e1e5f0] dark:bg-white/20',
                )}
              />
            ))}
            {busy && <Loader2 className="absolute -right-7 h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          {/* Reserved line: an error never pushes the keypad down. */}
          <p className="mt-3 min-h-[1.25rem] text-[13px] font-medium leading-5 text-destructive" role="alert">{error}</p>
          {note && <p className="text-[13px] text-muted-foreground md:text-xs">{note}</p>}
        </>
      }
      bottom={
        <>
          <div className="grid grid-cols-3 gap-2.5 md:gap-2">
            {DIGITS.map((d) => (
              <button key={d} type="button" className={cn(key, 'text-2xl font-medium md:text-xl')} onClick={() => press(d)} disabled={busy}>{d}</button>
            ))}
            <button type="button" className={cn(key, 'text-muted-foreground')} onClick={back} disabled={busy} aria-label="Effacer">
              <Delete className="h-6 w-6 md:h-5 md:w-5" strokeWidth={1.75} />
            </button>
            <button type="button" className={cn(key, 'text-2xl font-medium md:text-xl')} onClick={() => press('0')} disabled={busy}>0</button>
            <button
              type="button"
              className={cn(
                key,
                'text-base font-semibold',
                complete && !busy ? 'border-0 bg-brand-gradient text-white shadow-brand hover:bg-brand-gradient dark:border-0' : 'text-muted-foreground/70',
              )}
              onClick={enter}
              disabled={busy || !complete}
            >
              Entrée
            </button>
          </div>
          {extra && <div className="flex justify-center pt-3">{extra}</div>}
          {footer && <div className="flex flex-col items-center gap-1.5 pt-4 text-sm text-foreground">{footer}</div>}
        </>
      }
    />
  );
}
