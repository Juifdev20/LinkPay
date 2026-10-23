import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { AuthField } from '@/components/auth/AuthField';
import { cn } from '@/lib/utils';
import { displayPhone, toNationalDigits } from '@/lib/mobile-money';
import { UserPlus, Loader2, UserMinus, Mail, Users, Phone, Clock, X, CheckCircle2 } from 'lucide-react';
import { PhoneInput, isCompletePhone } from '@/components/PhoneInput';
import { Label } from '@/components/ui/label';

const ROLE_LABEL: Record<string, string> = { owner: 'Propriétaire', cashier: 'Caissier' };
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

export default function MerchantTeamPage() {
  const queryClient = useQueryClient();
  // The person is found by their phone number (what everybody has) or their email; they accept in their own app.
  const [by, setBy] = useState<'phone' | 'email'>('phone');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [sent, setSent] = useState<{ name: string; phone: string | null } | null>(null);
  const target = by === 'phone' ? isCompletePhone(phone) : !!email;

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

  const { data: invitations } = useQuery({
    queryKey: ['merchant-invitations', merchant?.id],
    queryFn: async () => (await api.get(`/merchants/${merchant.id}/invitations`)).data as any[],
    enabled: !!merchant?.id,
  });

  const inviteMutation = useMutation({
    mutationFn: async () =>
      (await api.post(`/merchants/${merchant.id}/users`, by === 'phone' ? { phone: `+243${phone}` } : { email })).data,
    onSuccess: (inv: any) => {
      queryClient.invalidateQueries({ queryKey: ['merchant-invitations', merchant?.id] });
      setSent({ name: inv?.invitee?.name ?? 'La personne', phone: inv?.invitee?.phone ?? null });
      setEmail('');
      setPhone('');
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

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/merchants/${merchant.id}/invitations/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['merchant-invitations', merchant?.id] }),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-5 pb-28 md:p-6 md:pb-6">
      <PageHeader title="Équipe" />

      {/* Computer: the invitation beside the list of members. */}
      <div className="space-y-4 lg:grid lg:grid-cols-5 lg:items-start lg:gap-6 lg:space-y-0">
      <section className="rounded-3xl border border-border bg-card p-5 shadow-soft lg:col-span-2">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-brand">
            <UserPlus className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-bold text-foreground">Inviter un caissier</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">Par son numéro ou son email : l'invitation arrive dans son application, à accepter.</p>
          </div>
        </div>
        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => { e.preventDefault(); if (target && merchant?.id) inviteMutation.mutate(); }}
        >
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1" role="tablist" aria-label="Inviter par">
            {([['phone', 'Téléphone', Phone], ['email', 'Email', Mail]] as const).map(([v, label, Icon]) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={by === v}
                onClick={() => { setBy(v); setInviteError(''); setSent(null); }}
                className={cn('flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-colors', by === v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>

          {by === 'phone' ? (
            <div className="space-y-1.5">
              <Label htmlFor="invite_phone">Numéro de son compte ScanLinkPay</Label>
              <PhoneInput id="invite_phone" value={phone} onChange={(d) => { setPhone(d); setInviteError(''); setSent(null); }} className="h-12" />
              {inviteError && <p role="alert" className="text-sm font-medium text-destructive">{inviteError}</p>}
            </div>
          ) : (
            <AuthField
              id="invite_email"
              label="Email de son compte"
              icon={Mail}
              type="email"
              autoComplete="off"
              placeholder="caissier@gmail.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setInviteError(''); setSent(null); }}
              error={inviteError}
            />
          )}

          {sent && (
            <p className="flex items-start gap-2 rounded-xl bg-success/10 px-3.5 py-2.5 text-sm text-foreground">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              <span>Invitation envoyée à <b>{sent.name}</b>{sent.phone ? ` (${sent.phone})` : ''}. Son compte deviendra caissier après acceptation, dans son application.</span>
            </p>
          )}

          <Button type="submit" className="h-12 w-full rounded-xl font-semibold" disabled={!target || !merchant?.id || inviteMutation.isPending}>
            {inviteMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
            Envoyer l'invitation
          </Button>
          <p className="text-xs text-muted-foreground">La personne doit déjà avoir un compte ScanLinkPay. Rien ne change sur son compte tant qu'elle n'a pas accepté.</p>
        </form>

        {!!invitations?.length && (
          <div className="mt-5 border-t border-border pt-4">
            <p className="mb-2 text-sm font-semibold text-muted-foreground">En attente de réponse</p>
            {invitations.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 py-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning"><Clock className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{inv.invitee?.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[inv.invitee?.phone, `expire le ${new Date(inv.expires_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={cancelMutation.isPending}
                  onClick={() => cancelMutation.mutate(inv.id)}
                  aria-label={`Annuler l'invitation de ${inv.invitee?.name}`}
                >
                  <X className="mr-1 h-4 w-4" /> Annuler
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-border bg-card px-4 py-2 shadow-soft sm:px-5 lg:col-span-3">
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
    </div>
  );
}
