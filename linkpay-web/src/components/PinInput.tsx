import { useRef } from 'react';
import { cn } from '@/lib/utils';

interface PinInputProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  autoFocus?: boolean;
  error?: boolean;
}

/**
 * Segmented numeric PIN entry (4-6 digits). Each box is its own input so the
 * native numeric keypad shows up on mobile (inputMode="numeric") without
 * needing a custom on-screen keyboard, and focus auto-advances/retreats as
 * the user types or backspaces.
 */
export function PinInput({ value, onChange, length = 4, autoFocus, error }: PinInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const digits = Array.from({ length }, (_, i) => value[i] || '');

  const setDigit = (index: number, char: string) => {
    const clean = char.replace(/\D/g, '').slice(-1);
    const next = digits.slice();
    next[index] = clean;
    onChange(next.join(''));
    if (clean && index < length - 1) {
      refs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (pasted) {
      e.preventDefault();
      onChange(pasted);
      refs.current[Math.min(pasted.length, length - 1)]?.focus();
    }
  };

  return (
    <div className="flex justify-center gap-2.5">
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          autoFocus={autoFocus && i === 0}
          value={digit}
          onChange={(e) => setDigit(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          className={cn(
            'w-12 h-14 text-center text-2xl font-bold rounded-xl border-2 bg-background text-foreground',
            'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors',
            error ? 'border-destructive' : 'border-input',
          )}
        />
      ))}
    </div>
  );
}
