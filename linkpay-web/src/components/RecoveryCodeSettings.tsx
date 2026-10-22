import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormSheet } from '@/components/FormSheet';
import { RecoveryCodePanel } from '@/components/auth/RecoveryCodePanel';
import { Loader2, LifeBuoy, ChevronRight } from 'lucide-react';

/**
 * Settings row: the recovery code — the way back in without SMS when the
 * password is forgotten. Older accounts have none yet (shown in amber); a
 * new one replaces the old. The password confirms it's the account's owner.
 */
export function RecoveryCodeSettings() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [code, setCode] = useState<string | null>(null);

  const { data: status } = useQuery({
    queryKey: ['recovery-code-status'],
    queryFn: async () => (await api.get('/auth/recovery-code')).data as { has_recovery_code: boolean },
  });
  const missing = status && !status.has_recovery_code;

  const close = () => {
    setOpen(false);
    setPassword('');
    setError('');
    setCode(null);
  };

  const issue = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/auth/recovery-code', { current_password: password });
      setCode(data.recovery_code);
      queryClient.invalidateQueries({ queryKey: ['recovery-code-status'] });
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Impossible de créer le code, réessayez.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="flex items-center gap-3 w-full px-6 py-3.5 border-b border-border text-left" onClick={() => setOpen(true)}>
        <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${missing ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive'}`}><LifeBuoy className="h-[18px] w-[18px]" /></span>
        <div className="flex-1">
          <p className="font-medium text-sm text-foreground">Code de secours</p>
          <p className={`text-xs ${missing ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`}>
            {missing ? "Vous n'en avez pas encore : créez-le pour pouvoir récupérer votre mot de passe." : 'Pour récupérer votre compte si vous oubliez le mot de passe.'}
          </p>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground" />
      </button>

      {open && (
        <FormSheet onClose={close} title="Code de secours">
          <div className="p-6">
            {code ? (
              <RecoveryCodePanel code={code} phone={user?.phone} onDone={close} doneLabel="Terminé" />
            ) : (
              <div className="space-y-4">
                <h2 className="text-xl font-bold text-foreground">{missing ? 'Créer mon code de secours' : 'Nouveau code de secours'}</h2>
                <p className="text-sm text-muted-foreground">
                  {missing
                    ? 'Ce code vous permettra de choisir un nouveau mot de passe si vous oubliez le vôtre.'
                    : "Un nouveau code remplace l'ancien, qui ne fonctionnera plus."}{' '}
                  Confirmez avec votre mot de passe.
                </p>
                <Input type="password" placeholder="Mot de passe actuel" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button className="w-full" disabled={!password || busy} onClick={issue}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {missing ? 'Créer le code' : 'Générer un nouveau code'}
                </Button>
              </div>
            )}
          </div>
        </FormSheet>
      )}
    </>
  );
}
