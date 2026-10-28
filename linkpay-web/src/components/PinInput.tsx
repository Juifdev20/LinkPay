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
  /** Title of the code screen. Default: "Entrez votre code PIN". */
  title?: string;
  /** A few words under the title ("Confirmez l'envoi de 5 000 FC à Marie"). */
  hint?: string;
  /** Error text shown on the code screen (e.g. "PIN incorrect"). */
  message?: string;
  /**
   * What « Annuler » does on the code screen, besides closing it. On a screen whose only content is this field (the
   * PIN step of a withdrawal, a send, a payment), cancelling must LEAVE that step — back to the recap — instead of
   * leaving the person in front of four empty boxes. Forms that have their own buttons around the field leave it out.
   */
  onCancel?: () => void;
}

/**
 * PIN / access code entry used everywhere in the app. The boxes on the page only show how many digits were typed;
 * tapping them (or arriving on a screen that asks for the code) opens the full-screen blue code screen — logo, white
 * card, big numeric keypad — the same one as the lock screen. The screen closes by itself once the code is complete,
 * the value goes up through onChange exactly as before, so callers did not change.
 */
export function PinInput({ value, onChange, length = 4, autoFocus, error, title, hint, message, onCancel }: PinInputProps) {
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(() => !!autoFocus && value.length < length);
  const wasComplete = useRef(value.length === length);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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

  // A refusal (wrong PIN, codes that differ…): the reason stays on screen and the boxes are red until the person
  // types a new code — never longer. A refused code left in the boxes is wiped and the code screen opens again at
  // once, so nobody has to tap red boxes and erase them first. The reason is kept even when the caller derives it
  // from the code itself (it disappears with the code we wipe).
  const [refusal, setRefusal] = useState<{ value: string; message?: string } | null>(error || message ? { value, message } : null);
  useEffect(() => {
    if (!error && !message) return;
    if (message && valueRef.current.length === length) {
      onChangeRef.current('');
      setOpen(true);
      setRefusal({ value: '', message });
    } else {
      setRefusal({ value: valueRef.current, message });
    }
  }, [error, message, length]);
  useEffect(() => {
    if (refusal && value !== refusal.value) setRefusal(null);
  }, [value, refusal]);
  const showError = !!refusal;

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
              showError ? 'border-destructive' : filled ? 'border-primary' : 'border-input',
            )}
          >
            {filled ? '•' : ''}
          </span>
        ))}
      </button>
      {open && createPortal(
        <PinKeypadScreen
          title={title ?? 'Entrez votre code PIN'}
          hint={hint}
          value={value}
          length={length}
          onChange={onChange}
          onEnter={() => setOpen(false)}
          error={refusal?.message}
          note={identityNote(user)}
          footer={
            <button type="button" className="py-1 font-semibold hover:text-primary" onClick={() => { onChange(''); setOpen(false); onCancel?.(); }}>
              Annuler
            </button>
          }
        />,
        document.body,
      )}
    </>
  );
}
