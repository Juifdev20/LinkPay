import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/auth-store';
import { PinKeypadScreen, identityNote } from '@/components/PinKeypadScreen';

interface PinInputProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  autoFocus?: boolean;
  error?: boolean;
  /** Title of the code screen. Default: "Entrer votre code PIN". */
  title?: string;
  /** A few words under the title ("Confirmez l'envoi de 5 000 FC à Marie"). */
  hint?: string;
  /** Error text shown on the code screen (e.g. "PIN incorrect"). */
  message?: string;
}

/**
 * PIN / access code entry used everywhere in the app. The boxes on the page only show how many digits were typed;
 * tapping them (or arriving on a screen that asks for the code) opens the full-screen blue code screen — logo, white
 * card, big numeric keypad — the same one as the lock screen. The screen closes by itself once the code is complete,
 * the value goes up through onChange exactly as before, so callers did not change.
 */
export function PinInput({ value, onChange, length = 4, autoFocus, error, title, hint, message }: PinInputProps) {
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(() => !!autoFocus && value.length < length);
  const wasComplete = useRef(value.length === length);

  const complete = value.length === length;
  useEffect(() => {
    if (open && complete) {
      const t = setTimeout(() => setOpen(false), 160); // lets the last dot show
      return () => clearTimeout(t);
    }
  }, [open, complete]);

  // The caller emptied the field after a refusal (wrong PIN…): ask again, with the reason on the code screen.
  useEffect(() => {
    if (autoFocus && message && wasComplete.current && value === '') setOpen(true);
    wasComplete.current = complete;
  }, [value, complete, autoFocus, message]);

  const boxes = Array.from({ length }, (_, i) => i < value.length);

  return (
    <>
      <button
        type="button"
        onClick={() => { if (complete) onChange(''); setOpen(true); }}
        aria-label={title ?? 'Saisir le code'}
        className="mx-auto flex justify-center gap-2.5"
      >
        {boxes.map((filled, i) => (
          <span
            key={i}
            className={cn(
              'w-12 h-14 flex items-center justify-center text-2xl font-bold rounded-xl border-2 bg-background text-foreground transition-colors',
              error ? 'border-destructive' : filled ? 'border-primary' : 'border-input',
            )}
          >
            {filled ? '•' : ''}
          </span>
        ))}
      </button>
      {open && createPortal(
        <PinKeypadScreen
          title={title ?? 'Entrer votre code PIN'}
          hint={hint}
          value={value}
          length={length}
          onChange={onChange}
          onEnter={() => setOpen(false)}
          error={message}
          note={identityNote(user)}
          footer={
            <button type="button" className="text-[16px] text-slate-700 py-1" onClick={() => { onChange(''); setOpen(false); }}>
              Annuler
            </button>
          }
        />,
        document.body,
      )}
    </>
  );
}
