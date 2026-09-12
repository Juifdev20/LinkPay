import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/lib/auth-store';
import { isAppLockEnabled, verifyAppLock } from '@/lib/webauthn';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/Logo';
import { Loader2, Fingerprint } from 'lucide-react';

// How long the app must have been hidden before we re-lock on return. Avoids
// re-locking on a brief blur (a file picker, a permission prompt, a quick
// alt-tab) while still catching a real app-switch, screen-off, or the PWA
// being backgrounded. A cheap starting heuristic — tune later if needed.
const RELOCK_AFTER_HIDDEN_MS = 5000;

/**
 * Full-screen overlay mounted once at the app root (see App.tsx) — not a
 * route wrapper — so it also covers an already-open tab/screen that gets
 * backgrounded and refocused, not just cold starts. Inert whenever the user
 * isn't authenticated or hasn't turned app-lock on.
 */
export function AppLockGate() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [locked, setLocked] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const hiddenAt = useRef<number | null>(null);

  // Cold start: lock immediately if the flag is on, before the
  // visibilitychange listener below would ever have a chance to fire.
  useEffect(() => {
    if (isAuthenticated && isAppLockEnabled()) setLocked(true);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const onVisibility = () => {
      if (!isAppLockEnabled()) return;
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
      } else if (document.visibilityState === 'visible' && hiddenAt.current !== null) {
        const hiddenMs = Date.now() - hiddenAt.current;
        hiddenAt.current = null;
        if (hiddenMs > RELOCK_AFTER_HIDDEN_MS) setLocked(true);
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [isAuthenticated]);

  const unlock = async () => {
    setVerifying(true);
    setError('');
    try {
      await verifyAppLock();
      setLocked(false);
    } catch {
      setError('Vérification échouée. Réessayez.');
    } finally {
      setVerifying(false);
    }
  };

  if (!isAuthenticated || !locked) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center gap-6 p-6">
      <Logo size="lg" />
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
        <Fingerprint className="w-8 h-8 text-primary" />
      </div>
      <p className="text-muted-foreground text-center max-w-xs">
        Déverrouillez LinkPay pour continuer
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={unlock} disabled={verifying} className="px-8 py-6 text-base font-semibold rounded-xl">
        {verifying && <Loader2 className="mr-2 w-5 h-5 animate-spin" />}
        Déverrouiller
      </Button>
    </div>
  );
}
