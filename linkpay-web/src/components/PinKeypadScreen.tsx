import { useEffect, useRef } from 'react';
import { Delete, Loader2 } from 'lucide-react';
import logoSrc from '@/assets/logo.png';

/** Brand blue of the logo (same family as the ScanLinkPay card), top to bottom. */
const BLUE = 'linear-gradient(180deg, #1a3cff 0%, #0f26d8 55%, #0a17a8 100%)';

/** "243891234218" → "*********218": all but the last three digits hidden. */
export function maskPhone(phone?: string | null): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length > 3 ? `${'*'.repeat(digits.length - 3)}${digits.slice(-3)}` : '';
}

/** "jean.dupont@gmail.com" → "je*********@gmail.com": for accounts that have no phone number. */
export function maskEmail(email?: string | null): string {
  const [name, domain] = String(email ?? '').split('@');
  if (!name || !domain) return '';
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(name.length - 2, 3))}@${domain}`;
}

/** The line shown under the field: the phone number if the account has one, else the e-mail address. */
export function identityNote(user?: { phone?: string | null; email?: string | null } | null): string | undefined {
  const phone = maskPhone(user?.phone);
  if (phone) return `Numéro de téléphone : ${phone}`;
  const email = maskEmail(user?.email);
  return email ? `Compte : ${email}` : undefined;
}

function Logo() {
  return (
    <div className="h-[clamp(100px,18vh,176px)] flex items-center justify-center" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <img src={logoSrc} alt="ScanLinkPay" className="w-[84px] h-[84px] rounded-[22px] shadow-lg ring-2 ring-white/30 object-cover" />
    </div>
  );
}

/** Blue full-screen page with the logo on top and a white card: for screens that need the normal keyboard. */
export function BlueCardScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto" style={{ background: BLUE }}>
      <div className="min-h-full max-w-md mx-auto flex flex-col">
        <Logo />
        <div className="mx-4 rounded-xl bg-white p-6 shadow-xl text-center space-y-4 text-slate-700">{children}</div>
      </div>
    </div>
  );
}

interface KeypadProps {
  /** e.g. "Entrer votre code PIN" */
  title: string;
  value: string;
  length: number;
  onChange: (value: string) => void;
  /** The "Entrée" key: available once the code is complete. */
  onEnter?: () => void;
  error?: string;
  /** Grey line under the field, e.g. "Numéro de téléphone : *********218". */
  note?: string;
  /** A few words under the title, when the screen needs explaining. */
  hint?: string;
  busy?: boolean;
  /** Links under the keypad ("Code PIN oublié?"…). */
  footer?: React.ReactNode;
  /** Extra action above the footer (fingerprint). */
  extra?: React.ReactNode;
}

const ROWS = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']];

/**
 * The code entry screen: blue page, the logo alone on top, a white card (title, the field, the phone number), and a
 * big numeric keypad at the bottom with a backspace key, 0 and "Entrée". Typing on a computer keyboard works too.
 * The field is read-only: on a phone the system keyboard never covers our own keypad.
 */
export function PinKeypadScreen({ title, value, length, onChange, onEnter, error, note, hint, busy, footer, extra }: KeypadProps) {
  // Refs so the keyboard listener always sees the current value without being re-attached on every digit.
  const state = useRef({ value, busy, onChange, onEnter, length });
  state.current = { value, busy, onChange, onEnter, length };

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
  const cell = 'h-[clamp(56px,9.5vh,76px)] flex items-center justify-center select-none touch-manipulation active:bg-slate-300/70 transition-colors disabled:opacity-60';

  return (
    // pointerEvents: auto — an open Radix dialog sets pointer-events:none on <body>, this screen must stay usable on top of it.
    <div data-pin-screen className="fixed inset-0 z-[100] flex flex-col overflow-y-auto" style={{ background: BLUE, pointerEvents: 'auto' }}>
      <div className="w-full max-w-md mx-auto flex flex-col flex-1">
        <Logo />

        <div className="mx-4 rounded-xl bg-white px-5 py-7 text-center shadow-xl">
          <p className="text-[19px] text-slate-700">{title}</p>
          {hint && <p className="mt-2 text-[13px] leading-snug text-slate-500">{hint}</p>}
          <div className="relative mt-7">
            <input
              type="password"
              readOnly
              inputMode="none"
              aria-label={title}
              value={value}
              className={`w-full h-[76px] rounded-lg border bg-white text-center text-[34px] tracking-[0.35em] text-slate-800 outline-none ${error ? 'border-red-400' : 'border-slate-300'}`}
            />
            {busy && <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 animate-spin text-slate-400" />}
          </div>
          {error && <p className="mt-4 text-[14px] font-medium text-red-600" role="alert">{error}</p>}
          {note && <p className="mt-6 text-[15px] text-slate-500">{note}</p>}
        </div>

        <div className="flex-1" />

        <div className="bg-[#e6ebf2] sm:rounded-t-2xl" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}>
          <div className="grid grid-cols-3">
            {ROWS.flat().map((d) => (
              <button key={d} type="button" className={`${cell} text-[40px] font-light text-slate-700`} onClick={() => press(d)} disabled={busy}>{d}</button>
            ))}
            <button type="button" className={`${cell} text-slate-600`} onClick={back} disabled={busy} aria-label="Effacer">
              <Delete className="w-8 h-8" strokeWidth={1.5} />
            </button>
            <button type="button" className={`${cell} text-[40px] font-light text-slate-700`} onClick={() => press('0')} disabled={busy}>0</button>
            <button type="button" className={`${cell} text-[24px] font-medium ${complete ? 'text-[#1a3cff]' : 'text-slate-400'}`} onClick={enter} disabled={busy || !complete}>Entrée</button>
          </div>
          {extra && <div className="flex justify-center pt-2">{extra}</div>}
          <div className="flex flex-col items-center gap-1 pt-4 pb-1 text-slate-700">{footer}</div>
        </div>
      </div>
    </div>
  );
}
