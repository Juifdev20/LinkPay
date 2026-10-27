import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { KeyRound, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/PasswordInput';
import { PasswordStrength } from '@/components/PasswordStrength';

/**
 * Creates (or changes) the personal code that unlocks a closed day in an emergency. Mandatory before the first closing:
 * the code is asked again, with a reason, every time the cash is unlocked.
 */
export function SecretForm({ change = false, merchantId, onDone }: { change?: boolean; merchantId?: string; onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [secret, setSecret] = useState('');
  const [confirm, setConfirm] = useState('');
  const m = useMutation({
    mutationFn: async () => (await api.post('/cash-book/unlock/secret', { secret, confirm, ...(change ? { current } : {}), merchant_id: merchantId })).data,
    onSuccess: onDone,
  });
  const mismatch = !!confirm && confirm !== secret;
  const ok = secret.length >= 6 && secret === confirm && (!change || !!current);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><KeyRound className="h-5 w-5" /></span>
        <div>
          <h2 className="text-lg font-bold">{change ? 'Changer mon code secret' : 'Créer mon code secret de déverrouillage'}</h2>
          <p className="text-sm text-muted-foreground">
            Une fois la caisse clôturée, plus aucune vente n’est possible. En cas d’urgence, ce code (avec un motif) permet de la déverrouiller.
            Il est personnel : ne le partagez pas. Chaque déverrouillage est tracé avec la date et l’heure.
          </p>
        </div>
      </div>
      {change && (
        <div className="space-y-1.5">
          <Label htmlFor="sc_current">Code actuel</Label>
          <PasswordInput id="sc_current" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="off" />
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="sc_new">Code secret (6 caractères minimum)</Label>
        <PasswordInput id="sc_new" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" />
        <PasswordStrength password={secret} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sc_confirm">Confirmer le code</Label>
        <PasswordInput id="sc_confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        {mismatch && <p className="text-xs font-medium text-destructive">La confirmation est différente du code.</p>}
      </div>
      {m.isError && (
        <p className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
          {(m.error as any)?.response?.data?.message || 'Enregistrement impossible — réessayez.'}
        </p>
      )}
      <Button className="w-full" disabled={!ok || m.isPending} onClick={() => m.mutate()}>
        {m.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Enregistrer mon code
      </Button>
    </div>
  );
}
