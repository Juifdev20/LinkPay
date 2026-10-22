import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Store, X } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ConfirmDialog';

/**
 * A shop inviting this person to become its cashier (migration 078): shown on their home screen until they answer.
 * Accepting turns the account into the shop's cashier at once (new token, no new sign-in); refusing changes nothing.
 */
export function MerchantInvitations() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const applyCashierUpgrade = useAuthStore((s) => s.applyCashierUpgrade);
  const [confirming, setConfirming] = useState<any>(null);
  const [error, setError] = useState('');

  const { data: invitations } = useQuery({
    queryKey: ['my-merchant-invitations'],
    queryFn: async () => (await api.get('/merchant-invitations/mine')).data as any[],
    refetchInterval: 60_000,
  });

  const answer = useMutation({
    mutationFn: async ({ id, accept }: { id: string; accept: boolean }) =>
      (await api.post(`/merchant-invitations/${id}/${accept ? 'accept' : 'decline'}`)).data,
    onSuccess: (data: any, { accept }) => {
      setError('');
      if (accept && data?.merchant_id) {
        applyCashierUpgrade(data.merchant_id, data.access_token);
        queryClient.clear();
        navigate('/dashboard', { replace: true });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['my-merchant-invitations'] });
    },
    onError: (err: any) => {
      const m = err?.response?.data?.message;
      setError((Array.isArray(m) ? m.join(' ') : m) || 'Réponse impossible pour le moment. Réessayez.');
      queryClient.invalidateQueries({ queryKey: ['my-merchant-invitations'] });
    },
  });

  if (!invitations?.length) return null;

  return (
    <div className="space-y-3">
      {invitations.map((inv) => (
        <section key={inv.id} className="rounded-3xl border border-primary/30 bg-primary/5 p-4 shadow-soft">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-brand">
              <Store className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-foreground">{inv.merchant?.name} vous invite comme caissier</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Vous pourrez encaisser les clients pour cette boutique{inv.merchant?.city ? ` (${inv.merchant.city})` : ''}. Votre compte deviendra un compte caissier.
              </p>
            </div>
          </div>
          {error && <p role="alert" className="mt-3 text-sm font-medium text-destructive">{error}</p>}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button variant="outline" disabled={answer.isPending} onClick={() => answer.mutate({ id: inv.id, accept: false })}>
              <X className="mr-1.5 h-4 w-4" /> Refuser
            </Button>
            <Button disabled={answer.isPending} onClick={() => setConfirming(inv)}>
              {answer.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />} Accepter
            </Button>
          </div>
        </section>
      ))}

      <ConfirmDialog
        open={!!confirming}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={`Devenir caissier de ${confirming?.merchant?.name ?? 'cette boutique'} ?`}
        description="Votre compte devient un compte caissier : vous encaisserez pour cette boutique. Vous gardez votre portefeuille et votre argent. Le propriétaire pourra vous retirer de l'équipe ; votre compte redeviendra alors un compte client."
        confirmLabel="Accepter"
        onConfirm={() => answer.mutate({ id: confirming.id, accept: true })}
      />
    </div>
  );
}
