import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, LockOpen } from 'lucide-react';
import api from '@/lib/api';
import { useCashUnlockPrompt } from '@/lib/cash-unlock-prompt';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/PasswordInput';

const MIN_REASON = 10;

/**
 * Mounted once in App.tsx: the emergency unlock of a closed day. Asks for the personal secret code and a reason (the code is
 * asked every time). The unlock is traced with the exact date and time and the manager is told.
 */
export function CashUnlockDialog() {
  const { target, answer } = useCashUnlockPrompt();
  const queryClient = useQueryClient();
  const [secret, setSecret] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => { if (!target) { setSecret(''); setReason(''); } }, [target]);

  const m = useMutation({
    mutationFn: async () => (await api.post(`/merchants/${target!.merchantId}/cash-book/closings/${target!.closingId}/unlock`, { secret, reason: reason.trim() })).data,
    onSuccess: () => {
      for (const key of ['cash-day', 'cash-month', 'cash-report', 'cash-unlock-events']) queryClient.invalidateQueries({ queryKey: [key] });
      answer(true);
    },
    onError: () => setSecret(''),
  });

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) answer(false); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><LockOpen className="h-5 w-5 text-amber-500" /> Déverrouiller la caisse (urgence)</DialogTitle>
          <DialogDescription>
            {target?.message || 'La journée est clôturée : la boutique est fermée.'} Pour une urgence, saisissez votre code secret et le motif.
            Cette action est enregistrée avec la date et l’heure, et le gérant est prévenu.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="un_secret">Votre code secret de déverrouillage</Label>
            <PasswordInput id="un_secret" autoFocus autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="un_reason">Motif de l’urgence</Label>
            <Input id="un_reason" value={reason} maxLength={500} placeholder="Ex. client pressé, livraison à régler" onChange={(e) => setReason(e.target.value)} />
            {reason.trim().length > 0 && reason.trim().length < MIN_REASON && <p className="text-xs text-muted-foreground">Encore {MIN_REASON - reason.trim().length} caractère(s) au moins.</p>}
          </div>
          {m.isError && (
            <p className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
              {(m.error as any)?.response?.data?.message || 'Déverrouillage impossible — réessayez.'}
            </p>
          )}
          <Button className="w-full" disabled={!secret || reason.trim().length < MIN_REASON || m.isPending} onClick={() => m.mutate()}>
            {m.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Déverrouiller la caisse
          </Button>
          <p className="text-xs text-muted-foreground">Après la vente d’urgence, pensez à clôturer de nouveau la caisse.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
