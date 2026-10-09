import { useState } from 'react';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { weakAppCodeReason } from '@/lib/code-strength';
import { appCodeApplies, IDLE_CHOICES_MIN, getIdleLockMinutes, setIdleLockMinutes } from '@/lib/app-lock-store';
import { PinInput } from '@/components/PinInput';
import { Button } from '@/components/ui/button';
import { Loader2, KeyRound, Timer, CheckCircle2 } from 'lucide-react';

/** Settings rows for the access code: change it (old code + new code twice) and pick the idle delay. */
export function AccessCodeSettings() {
  const role = useAuthStore((s) => s.user?.role);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [code, setCode] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [idle, setIdle] = useState(getIdleLockMinutes());

  const weak = code.length === 6 ? weakAppCodeReason(code) : null;
  const same = code.length === 6 && code === current;
  const mismatch = confirm.length === 6 && confirm !== code;
  const ready = current.length === 6 && code.length === 6 && confirm.length === 6 && !weak && !same && !mismatch;

  const close = () => { setOpen(false); setCurrent(''); setCode(''); setConfirm(''); setError(''); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.put('/auth/app-code', { current_code: current, code, confirm_code: confirm });
      close();
      setDone(true);
      window.setTimeout(() => setDone(false), 4000);
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.code === 'SESSION_TERMINATED') {
        window.location.href = '/login';
        return;
      }
      setError(data?.message || 'Modification impossible.');
      setCurrent('');
    } finally {
      setBusy(false);
    }
  };

  if (!appCodeApplies(role)) return null; // staff and administrators don't use the access code

  return (
    <>
      <div className="px-6 py-3.5 border-b border-border">
        <button className="flex items-center gap-3 w-full text-left" onClick={() => (open ? close() : setOpen(true))}>
          <KeyRound className="w-5 h-5 text-muted-foreground flex-shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-sm text-foreground">Code d'accès</p>
            <p className="text-xs text-muted-foreground">Demandé à chaque ouverture de l'application. Modifier votre code à 6 chiffres.</p>
          </div>
          {done && <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />}
        </button>
        {open && (
          <form onSubmit={submit} className="mt-4 space-y-4">
            {error && <p className="text-sm text-destructive font-medium">{error}</p>}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-foreground text-center">Code actuel</p>
              <PinInput value={current} onChange={setCurrent} length={6} autoFocus />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold text-foreground text-center">Nouveau code</p>
              <PinInput value={code} onChange={setCode} length={6} error={!!weak || same} />
              {weak && <p className="text-xs text-destructive text-center">{weak}</p>}
              {same && <p className="text-xs text-destructive text-center">Le nouveau code doit être différent de l'ancien.</p>}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold text-foreground text-center">Confirmez le nouveau code</p>
              <PinInput value={confirm} onChange={setConfirm} length={6} error={mismatch} />
              {mismatch && <p className="text-xs text-destructive text-center">Les deux codes ne sont pas identiques.</p>}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={close}>Annuler</Button>
              <Button type="submit" className="flex-1" disabled={!ready || busy}>
                {busy && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}Modifier
              </Button>
            </div>
          </form>
        )}
      </div>
      <div className="flex items-center gap-3 w-full px-6 py-3.5 border-b border-border">
        <Timer className="w-5 h-5 text-muted-foreground flex-shrink-0" />
        <div className="flex-1">
          <p className="font-medium text-sm text-foreground">Verrouillage automatique</p>
          <p className="text-xs text-muted-foreground">Redemande le code après ce délai sans utilisation.</p>
        </div>
        <select
          className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm font-medium"
          value={idle}
          onChange={(e) => { const v = Number(e.target.value); setIdle(v); setIdleLockMinutes(v); }}
        >
          {IDLE_CHOICES_MIN.map((m) => <option key={m} value={m}>{m} min</option>)}
        </select>
      </div>
    </>
  );
}
