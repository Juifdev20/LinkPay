import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '@/lib/auth-store';
import { useAppLock, BACKGROUND_LOCK_MS, getIdleLockMinutes, appCodeApplies, isSalesRoute } from '@/lib/app-lock-store';
import { isAppLockEnabled, verifyAppLock } from '@/lib/app-lock';
import { weakAppCodeReason } from '@/lib/code-strength';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PinKeypadScreen, BlueCardScreen, maskPhone } from '@/components/PinKeypadScreen';
import { Loader2, Fingerprint } from 'lucide-react';

const errorMessage = (err: any, fallback: string) => err?.response?.data?.message || fallback;

/**
 * Full-screen overlay mounted once at the app root (see App.tsx). It:
 *   1. makes a user (client / merchant / business owner) without an access code choose one (new accounts, and
 *      existing accounts the first time they open this version);
 *   2. locks the app on launch, after the app was left, and after idle time;
 *   3. is an ENTRANCE check only: it never interrupts someone moving between
 *      tabs and screens, and it stays out of the selling/stock screens and
 *      away from administrators (see APP_CODE_ROLES / SALES_ROUTE_PREFIXES);
 *   4. unlocks with the 6-digit code (checked by the API: 5 tries, then a
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
  const { pathname } = useLocation();
  // Clients, merchants, business owners and their employees (not administrators).
  // An employee's first login starts with the forced change of the temporary
  // password; the access code is chosen right after, not on top of it.
  const applies = isAuthenticated && appCodeApplies(user?.role) && !user?.must_change_password;
  const onSalesScreen = isSalesRoute(pathname);
  // A lock request while a sales/stock screen is open is dropped, not postponed:
  // the code is never asked later, mid-navigation, because of something that
  // happened on a screen where it must not appear.
  const lockUnlessSelling = useCallback(() => {
    if (!isSalesRoute(window.location.pathname)) lock();
  }, [lock]);

  // Opening the app straight onto a sales/stock screen is not an entrance to guard.
  useEffect(() => {
    if (applies && onSalesScreen && locked) unlock();
  }, [applies, onSalesScreen, locked, unlock]);

  // Profiles cached by an older version don't know yet: ask the server.
  useEffect(() => {
    if (applies && hasCode === undefined) fetchProfile();
  }, [applies, hasCode, fetchProfile]);

  // Leaving the app → lock when coming back after the grace period.
  useEffect(() => {
    if (!applies) return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
      } else if (hiddenAt.current !== null) {
        const away = Date.now() - hiddenAt.current;
        hiddenAt.current = null;
        if (away > BACKGROUND_LOCK_MS) lockUnlessSelling();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [applies, lockUnlessSelling]);

  // Idle → lock (not while a sales/stock screen is open: those stay up for hours).
  useEffect(() => {
    if (!applies || locked) return;
    lastActivity.current = Date.now();
    const touch = () => { lastActivity.current = Date.now(); };
    const events = ['pointerdown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true, capture: true }));
    const timer = window.setInterval(() => {
      if (isSalesRoute(window.location.pathname)) { lastActivity.current = Date.now(); return; }
      if (Date.now() - lastActivity.current > getIdleLockMinutes() * 60_000) lockUnlessSelling();
    }, 5_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch, { capture: true }));
      window.clearInterval(timer);
    };
  }, [applies, locked, lockUnlessSelling]);

  const onUnlocked = useCallback(() => {
    lastActivity.current = Date.now();
    unlock();
  }, [unlock]);

  if (!applies || onSalesScreen) return null;
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

const CODE_LENGTH = 6;

function UnlockScreen({ onUnlocked, onForgot, onLogout }: { onUnlocked: () => void; onForgot: () => Promise<void>; onLogout: () => Promise<void> }) {
  const phone = useAuthStore((s) => s.user?.phone);
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
      <BlueCardScreen>
        <p className="text-[19px]">Code oublié ?</p>
        <p className="text-[13px] leading-snug text-slate-500">Confirmez avec le mot de passe de votre compte, puis choisissez un nouveau code.</p>
        <form onSubmit={reset} className="space-y-3">
          {error && <p className="text-sm text-red-600 font-medium" role="alert">{error}</p>}
          <Input type="password" autoFocus placeholder="Mot de passe du compte" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          <Button type="submit" className="w-full" disabled={busy || !password}>
            {busy && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}Continuer
          </Button>
          <button type="button" className="text-xs text-slate-500 underline w-full" onClick={() => { setForgot(false); setError(''); }}>Retour</button>
        </form>
      </BlueCardScreen>
    );
  }

  return (
    <PinKeypadScreen
      title="Entrer votre code PIN"
      value={code}
      length={CODE_LENGTH}
      busy={busy}
      error={error}
      note={maskPhone(phone) ? `Numéro de téléphone : ${maskPhone(phone)}` : undefined}
      onChange={(v) => {
        setCode(v);
        if (v.length === CODE_LENGTH && !busy) void submit(v);
      }}
      onEnter={() => void submit(code)}
      extra={biometric ? (
        <button type="button" className="flex items-center gap-2 text-sm text-slate-600 underline" onClick={tryBiometric} disabled={busy}>
          <Fingerprint className="w-4 h-4" />Utiliser l'empreinte / le visage
        </button>
      ) : undefined}
      footer={(
        <>
          <button type="button" className="text-[19px]" onClick={() => { setForgot(true); setError(''); }}>Code PIN oublié?</button>
          <button type="button" className="text-xs text-slate-500 underline" onClick={async () => { await onLogout(); window.location.href = '/login'; }}>Se déconnecter</button>
        </>
      )}
    />
  );
}

/** First use (or after a reset): choose the code, then type it again. Same screen as the unlock one. */
function CreateCode({ onDone }: { onDone: () => Promise<void> }) {
  const [code, setCode] = useState('');
  const [confirm, setConfirm] = useState('');
  const [step, setStep] = useState<'choose' | 'confirm'>('choose');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (chosen: string, again: string) => {
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/app-code', { code: chosen, confirm_code: again });
      await onDone();
    } catch (err: any) {
      setError(errorMessage(err, 'Impossible d’enregistrer le code.'));
      setConfirm('');
    } finally {
      setBusy(false);
    }
  };

  const chosen = (v: string) => {
    setCode(v);
    setError('');
    if (v.length !== CODE_LENGTH) return;
    const weak = weakAppCodeReason(v);
    if (weak) {
      setError(weak);
      setTimeout(() => setCode(''), 0);
      return;
    }
    setStep('confirm');
  };

  const confirmed = (v: string) => {
    setConfirm(v);
    setError('');
    if (v.length !== CODE_LENGTH) return;
    if (v !== code) {
      setError('Les deux codes ne sont pas identiques.');
      setConfirm('');
      return;
    }
    void save(code, v);
  };

  if (step === 'choose') {
    return (
      <PinKeypadScreen
        title="Créez votre code d'accès"
        hint="Ce code à 6 chiffres vous sera demandé à chaque ouverture de l'application et après quelques minutes d'inactivité. Ne le partagez avec personne."
        value={code}
        length={CODE_LENGTH}
        error={error}
        onChange={chosen}
      />
    );
  }
  return (
    <PinKeypadScreen
      title="Confirmez votre code"
      hint="Saisissez de nouveau le même code."
      value={confirm}
      length={CODE_LENGTH}
      busy={busy}
      error={error}
      onChange={confirmed}
      onEnter={() => confirmed(confirm)}
      footer={<button type="button" className="text-[17px]" onClick={() => { setStep('choose'); setCode(''); setConfirm(''); setError(''); }}>Changer de code</button>}
    />
  );
}
