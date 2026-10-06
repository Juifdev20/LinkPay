import { cn } from '@/lib/utils';

/** 0–4 score from length and character variety. */
export function passwordScore(password: string): number {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
  return Math.min(score, 4);
}

const LABELS = ['Très faible', 'Faible', 'Moyen', 'Fort', 'Très fort'];
const COLORS = ['bg-destructive', 'bg-destructive', 'bg-warning', 'bg-success', 'bg-success'];

/** Three-segment strength meter shown while a password is being chosen. */
export function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const score = passwordScore(password);
  const level = Math.max(score, 1);
  return (
    <div className="space-y-1.5" aria-live="polite">
      <div className="flex gap-1.5">
        {[1, 2, 3].map((segment) => (
          <div
            key={segment}
            className={cn('h-1.5 flex-1 rounded-full bg-border', score >= segment && COLORS[level])}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Force : <span className="font-semibold text-foreground">{LABELS[level]}</span>
        {score < 3 && ' — ajoute des majuscules, des chiffres et un symbole'}
      </p>
    </div>
  );
}
