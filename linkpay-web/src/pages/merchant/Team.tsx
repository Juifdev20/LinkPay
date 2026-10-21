import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { AuthField } from '@/components/auth/AuthField';
import { cn } from '@/lib/utils';
import { displayPhone, toNationalDigits } from '@/lib/mobile-money';
import { UserPlus, Loader2, UserMinus, Mail, Users } from 'lucide-react';

const ROLE_LABEL: Record<string, string> = { owner: 'Propriétaire', cashier: 'Caissier' };
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

export default function MerchantTeamPage() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [inviteError, setInviteError] = useState('');

  const { data: merchant } = useQuery({
    queryKey: ['my-merchant'],
    queryFn: async () => {
      const { data } = await api.get('/merchants/me');
      return data;
    },
  });

  const { data: team } = useQuery({
    queryKey: ['merchant-team', merchant?.id],
    queryFn: async () => {
      const { data } = await api.get(`/merchants/${merchant.id}/users`);
      return data;
    },
    enabled: !!merchant?.id,
  });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/merchants/${merchant.id}/users`, { email });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merchant-team', merchant?.id] });
      setEmail('');
      setInviteError('');
    },
    onError: (err: any) => {
      setInviteError(err.response?.data?.message || "Échec de l'invitation");
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (userId: string) => {
      await api.delete(`/merchants/${merchant.id}/users/${userId}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['merchant-team', merchant?.id] }),
  });
  const removeError = (removeMutation.error as any)?.response?.data?.message;

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-5 pb-28 md:p-6 md:pb-6">
      <PageHeader title="Équipe" />

      <section className="rounded-3xl border border-border bg-card p-5 shadow-soft">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-brand">
            <UserPlus className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-bold text-foreground">Inviter un caissier</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">Il pourra encaisser pour votre boutique. Il doit déjà avoir un compte ScanLinkPay.</p>
          </div>
        </div>
        <form
          className="mt-5"
          onSubmit={(e) => { e.preventDefault(); if (email && merchant?.id) inviteMutation.mutate(); }}
        >
          <AuthField
            id="invite_email"
            label="Email de son compte"
            icon={Mail}
            type="email"
            autoComplete="off"
            placeholder="caissier@gmail.com"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setInviteError(''); }}
            error={inviteError}
          />
          <Button type="submit" className="mt-1 h-12 w-full rounded-xl font-semibold" disabled={!email || !merchant?.id || inviteMutation.isPending}>
            {inviteMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
            Inviter
          </Button>
        </form>
      </section>

      <section className="rounded-3xl border border-border bg-card px-4 py-2 shadow-soft sm:px-5">
        <p className="pt-3 text-sm font-semibold text-muted-foreground">{team?.length || 0} membre{(team?.length || 0) > 1 ? 's' : ''}</p>
        {removeMutation.isError && (
          <p role="alert" className="mt-2 rounded-xl bg-destructive/10 px-3.5 py-2.5 text-sm font-medium text-destructive">{removeError || 'Le retrait a échoué. Réessayez.'}</p>
        )}
        {team?.length ? (
          team.map((m: any) => {
            const name = m.user?.full_name || m.user?.email || 'Utilisateur';
            const slug = m.role?.slug ?? '';
            return (
              <div key={m.id} className="flex items-center gap-3 border-b border-border py-3.5 last:border-0">
                <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold', slug === 'owner' ? 'bg-brand-gradient text-white' : 'bg-primary/10 text-primary')}>
                  {initials(name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{name}</p>
                  <p className="truncate text-xs text-muted-foreground">{m.user?.email || (m.user?.phone ? displayPhone(toNationalDigits(m.user.phone)) : '')}</p>
                </div>
                <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold', slug === 'owner' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
                  {ROLE_LABEL[slug] ?? slug}
                </span>
                {/* Only cashiers can be removed — never the store's owner. */}
                {slug === 'cashier' && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9 shrink-0 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                    title="Retirer de l'équipe"
                    aria-label={`Retirer ${name} de l'équipe`}
                    disabled={removeMutation.isPending}
                    onClick={() => removeMutation.mutate(m.user_id)}
                  >
                    {removeMutation.isPending && removeMutation.variables === m.user_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserMinus className="h-4 w-4" />}
                  </Button>
                )}
              </div>
            );
          })
        ) : (
          <div className="flex flex-col items-center py-10 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Users className="h-7 w-7" /></span>
            <p className="mt-3 font-semibold text-foreground">Vous êtes seul pour l'instant</p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">Invitez un caissier pour encaisser à plusieurs.</p>
          </div>
        )}
      </section>
    </div>
  );
}
