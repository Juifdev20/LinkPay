import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, KeyRound } from 'lucide-react';

/** Owner-only override — overwrites the stock password without knowing the
 * current one (see /stock-password/reset, restricted server-side to the
 * organization's owner or a platform admin). */
export function StockPasswordResetDialog({ orgId, open, onClose }: { orgId: string; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const resetMutation = useMutation({
    mutationFn: async () => api.post(`/organizations/${orgId}/stock-password/reset`, { new_password: newPassword }),
    onSuccess: () => {
      setDone(true);
      queryClient.invalidateQueries({ queryKey: ['stock-password-status', orgId] });
    },
    onError: (err: any) => setError(err.response?.data?.message || 'Échec — réessaie.'),
  });

  const handleClose = () => {
    setNewPassword('');
    setError('');
    setDone(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-2">
            <KeyRound className="w-6 h-6 text-primary" />
          </div>
          <DialogTitle>Réinitialiser le mot de passe du stock</DialogTitle>
          <DialogDescription>
            Choisis un nouveau mot de passe — l'ancien ne sera plus valide. À communiquer à ton équipe.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <p className="text-sm text-success text-center py-2">Mot de passe réinitialisé avec succès.</p>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="reset_stock_pwd">Nouveau mot de passe</Label>
            <Input id="reset_stock_pwd" type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoFocus />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          {done ? (
            <Button onClick={handleClose}>Fermer</Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose}>Annuler</Button>
              <Button disabled={newPassword.length < 4 || resetMutation.isPending} onClick={() => resetMutation.mutate()}>
                {resetMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
                Réinitialiser
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
