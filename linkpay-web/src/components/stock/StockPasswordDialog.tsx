import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import api from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Lock, Eye, EyeOff } from 'lucide-react';

/**
 * Gate shown before an edit/delete goes through — consulting the stock list
 * itself stays open (product decision), only modifying it is protected.
 * First visit ever: no password exists yet, so this doubles as the "define
 * it now" screen. Every visit after that: asks for the existing one and
 * verifies it server-side (StockPasswordService) before calling
 * `onUnlocked`, which the caller uses to actually perform the edit/delete.
 */
export function StockPasswordDialog({
  orgId,
  open,
  onClose,
  onUnlocked,
}: {
  orgId: string;
  open: boolean;
  onClose: () => void;
  onUnlocked: (password: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const { data: status } = useQuery({
    queryKey: ['stock-password-status', orgId],
    queryFn: async () => (await api.get(`/organizations/${orgId}/stock-password/status`)).data,
    enabled: open && !!orgId,
  });
  const isSet = !!status?.is_set;

  const reset = () => {
    setPassword('');
    setConfirmPassword('');
    setError('');
  };

  const setMutation = useMutation({
    mutationFn: async () => api.post(`/organizations/${orgId}/stock-password/set`, { password }),
    onSuccess: () => {
      const p = password;
      reset();
      onUnlocked(p);
    },
    onError: (err: any) => setError(err.response?.data?.message || 'Échec — réessaie.'),
  });

  const verifyMutation = useMutation({
    mutationFn: async () => api.post(`/organizations/${orgId}/stock-password/verify`, { password }),
    onSuccess: () => {
      const p = password;
      reset();
      onUnlocked(p);
    },
    onError: (err: any) => setError(err.response?.data?.message || 'Mot de passe incorrect.'),
  });

  const pending = setMutation.isPending || verifyMutation.isPending;

  const handleSubmit = () => {
    setError('');
    if (!isSet) {
      if (password.length < 4) {
        setError('Le mot de passe doit comporter au moins 4 caractères.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Les mots de passe ne correspondent pas.');
        return;
      }
      setMutation.mutate();
    } else {
      verifyMutation.mutate();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-2">
            <Lock className="w-6 h-6 text-primary" />
          </div>
          <DialogTitle>{isSet ? 'Mot de passe de gestion de stock' : 'Définir le mot de passe de gestion de stock'}</DialogTitle>
          <DialogDescription>
            {isSet
              ? 'Requis pour modifier ou supprimer un article.'
              : "Première utilisation du module — choisis un mot de passe pour protéger les modifications et suppressions d'articles. Ton administrateur pourra le réinitialiser si besoin."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="stock_pwd">{isSet ? 'Mot de passe' : 'Nouveau mot de passe'}</Label>
            <div className="relative">
              <Input
                id="stock_pwd"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-10"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {!isSet && (
            <div className="space-y-2">
              <Label htmlFor="stock_pwd_confirm">Confirmer le mot de passe</Label>
              <Input
                id="stock_pwd_confirm"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>
            Annuler
          </Button>
          <Button disabled={!password || pending} onClick={handleSubmit}>
            {pending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
            {isSet ? 'Confirmer' : 'Définir'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
