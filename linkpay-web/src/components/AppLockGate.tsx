import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/lib/auth-store';
import { useAppLock, BACKGROUND_LOCK_MS, getIdleLockMinutes } from '@/lib/app-lock-store';
import { isAppLockEnabled, verifyAppLock } from '@/lib/app-lock';
import { weakAppCodeReason } from '@/lib/code-strength';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Logo } from '@/components/Logo';
import { PinInput } from '@/components/PinInput';
import { Loader2, Fingerprint, Lock, ShieldCheck } from 'lucide-react';

const errorMessage = (err: any, fallback: string) => err?.response?.data?.message || fallback;

/**
 * Full-screen overlay mounted once at the app root (see App.tsx). It:
 *   1. makes a user without an access code choose one (new accounts, and
 *      existing accounts the first time they open this version);
 *   2. locks the app on launch, after the app was left, and after idle time;
 *   3. unlocks with the 6-digit code (checked by the API: 5 tries, then a
 *      15-minute lock; two locks in a row end the session) or, as an optional
 *      shortcut, the device biometrics.
 * It also covers the screen while it is locked, so nothing shows behind it.
 */
export function AppLockGate() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const fetchProfile = useAuthStore((s) => s.fetchProfile);
  const logout = useAuthStore((s) => s.logout);
  const { locked, lock, unlock } = useAppLock();

  const hiddenAt = useRef<number | null>(null);
  const lastActivity = useRef(Date.now());
  const hasCode = user?.has_app_code;

  // Profiles cached by an older version don't know yet: ask the server.
  useEffect(() => {
    if (isAuthenticated && hasCode === undefined) fetchProfile();
  }, [isAuthenticated, hasCode, fetchProfile]);

  // Leaving the app → lock when coming back after the grace period.
  useEffect(() => {
    if (!isAuthenticated) return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
      } else if (hiddenAt.current !== null) {
        const away = Date.now() - hiddenAt.current;
        hiddenAt.current = null;
        if (away > BACKGROUND_LOCK_MS) lock();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [isAuthenticated, lock]);

  // Idle → lock.
  useEffect(() => {
    if (!isAuthenticated || locked) return;
    lastActivity.current = Date.now();
    const touch = () => { lastActivity.current = Date.now(); };
    const events = ['pointerdown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true, capture: true }));
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity.current > getIdleLockMinutes() * 60_000) lock();
    }, 5_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch, { capture: true }));
      window.clearInterval(timer);
    };
  }, [isAuthenticated, locked, lock]);

  const onUnlocked = useCallback(() => {
    lastActivity.current = Date.now();
    unlock();
  }, [unlock]);

  if (!isAuthenticated) return null;
  // The user's admin 2FA enrolment screen comes first; this gate waits.
  if (hasCode === false) return <CreateCode onDone={async () => { await fetchProfile(); onUnlocked(); }} />;
  if (!locked) return null;
  if (hasCode === undefined) {
    return (
      <div className="fixed inset-0 z-[100] bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }
  return <UnlockScreen onUnlocked={onUnlocked} onForgot={async () => { await fetchProfile(); }} onLogout={logout} />;
}

function Shell({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] bg-background overflow-y-auto">
      <div className="min-h-full flex flex-col items-center justify-center gap-5 p-6">
        <Logo size="lg" />
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">{icon}</div>
        <div className="text-center max-w-xs space-y-1">
          <h1 className="text-lg font-bold text-foreground">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="w-full max-w-xs space-y-4">{children}</div>
      </div>
    </div>
  );
}

function UnlockScreen({ onUnlocked, onForgot, onLogout }: { onUnlocked: () => void; onForgot: () => Promise<void>; onLogout: () => Promise<void> }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [password, setPassword] = useState('');
  const biometric = isAppLockEnabled();

  const submit = async (value: string) => {
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/app-code/verify', { code: value });
      onUnlocked();
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.code === 'SESSION_TERMINATED') {
        await onLogout();
        window.location.href = '/login';
        return;
      }
      setError(errorMessage(err, 'Vérification impossible. Réessayez.'));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const tryBiometric = async () => {
    setError('');
    try {
      await verifyAppLock();
      onUnlocked();
    } catch {
      setError('Vérification biométrique échouée. Saisissez votre code.');
    }
  };

  const reset = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/app-code/reset', { password });
      await onForgot(); // profile now says has_app_code: false → the gate shows the "choose a code" screen
    } catch (err: any) {
      setError(errorMessage(err, 'Réinitialisation impossible.'));
    } finally {
      setBusy(false);
    }
  };

  if (forgot) {
    return (
      <Shell icon={<Lock className="w-8 h-8 text-primary" />} title="Code oublié ?" subtitle="Confirmez avec le mot de passe de votre compte, puis choisissez un nouveau code.">
        <form onSubmit={reset} className="space-y-3">
          {error && <p className="text-sm text-destructive text-center">{error}</p>}
          <Input type="password" autoFocus placeholder="Mot de passe du compte" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          <Button type="submit" className="w-full" disabled={busy || !password}>
            {busy && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}Continuer
          </Button>
          <button type="button" className="text-xs text-muted-foreground underline w-full" onClick={() => { setForgot(false); setError(''); }}>Retour</button>
        </form>
      </Shell>
    );
  }

  return (
    <Shell icon={<Lock className="w-8 h-8 text-primary" />} title="Saisissez votre code d'accès" subtitle="Pour votre sécurité, ScanLinkPay est verrouillé.">
      {error && <p className="text-sm text-destructive text-center font-medium">{error}</p>}
      <PinInput
        key={error /* refocus the first box after a wrong code */}
        value={code}
        length={6}
        autoFocus
        error={!!error}
        onChange={(v) => {
          setCode(v);
          if (v.length === 6 && !busy) void submit(v);
        }}
      />
      {busy && <div className="flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>}
      {biometric && (
        <Button variant="outline" className="w-full" onClick={tryBiometric} disabled={busy}>
          <Fingerprint className="mr-2 w-4 h-4" />Utiliser l'empreinte / le visage
        </Button>
      )}
      <div className="flex justify-between text-xs text-muted-foreground">
        <button className="underline" onClick={() => { setForgot(true); setError(''); }}>Code oublié ?</button>
        <button className="underline" onClick={async () => { await onLogout(); window.location.href = '/login'; }}>Se déconnecter</button>
      </div>
    </Shell>
  );
}

function CreateCode({ onDone }: { onDone: () => Promise<void> }) {
  const [code, setCode] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const weak = code.length === 6 ? weakAppCodeReason(code) : null;
  const mismatch = confirm.length === 6 && confirm !== code;
  const ready = code.length === 6 && confirm.length === 6 && !weak && !mismatch;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/app-code', { code, confirm_code: confirm });
      await onDone();
    } catch (err: any) {
      setError(errorMessage(err, 'Impossible d’enregistrer le code.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      icon={<ShieldCheck className="w-8 h-8 text-primary" />}
      title="Créez votre code d'accès"
      subtitle="Ce code à 6 chiffres vous sera demandé à chaque ouverture de l'application et après quelques minutes d'inactivité. Ne le partagez avec personne."
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="text-sm text-destructive text-center font-medium">{error}</p>}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-foreground text-center">Nouveau code</p>
          <PinInput value={code} onChange={setCode} length={6} autoFocus error={!!weak} />
          {weak && <p className="text-xs text-destructive text-center">{weak}</p>}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold text-foreground text-center">Confirmez le code</p>
          <PinInput value={confirm} onChange={setConfirm} length={6} error={mismatch} />
          {mismatch && <p className="text-xs text-destructive text-center">Les deux codes ne sont pas identiques.</p>}
        </div>
        <Button type="submit" className="w-full" disabled={!ready || busy}>
          {busy && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}Enregistrer mon code
        </Button>
      </form>
    </Shell>
  );
}
