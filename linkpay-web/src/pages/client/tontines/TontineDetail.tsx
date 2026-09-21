import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PinInput } from '@/components/PinInput';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Loader2, ArrowLeft, Check, Clock, Shuffle, UserPlus, Crown, Info, Settings } from 'lucide-react';

const STATUS_LABEL: Record<string, string> = {
  forming: 'En formation',
  active: 'En cours',
  completed: 'Terminée',
  cancelled: 'Annulée',
};

export default function TontineDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [walletNumber, setWalletNumber] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [pin, setPin] = useState('');
  const [contributeError, setContributeError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['tontine', id],
    queryFn: async () => (await api.get(`/tontines/${id}`)).data,
    enabled: !!id,
  });

  useRealtimeInvalidate('tontine_contributions', id ? `group_id=eq.${id}` : undefined, [['tontine', id]], !!id);
  useRealtimeInvalidate('tontine_members', id ? `group_id=eq.${id}` : undefined, [['tontine', id]], !!id);

  const inviteMutation = useMutation({
    mutationFn: async () => (await api.post(`/tontines/${id}/invite`, { wallet_number: walletNumber })).data,
    onSuccess: () => {
      setWalletNumber('');
      setInviteError('');
      queryClient.invalidateQueries({ queryKey: ['tontine', id] });
    },
    onError: (err: any) => setInviteError(err.response?.data?.message || 'Échec de l\'invitation'),
  });

  const cancelInviteMutation = useMutation({
    mutationFn: async (memberId: string) => (await api.delete(`/tontines/${id}/members/${memberId}`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tontine', id] }),
  });

  const drawMutation = useMutation({
    mutationFn: async () => (await api.post(`/tontines/${id}/draw`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tontine', id] }),
  });

  const respondMutation = useMutation({
    mutationFn: async (accept: boolean) => (await api.post(`/tontines/${id}/${accept ? 'accept' : 'decline'}`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tontine', id] });
      queryClient.invalidateQueries({ queryKey: ['tontines'] });
    },
  });

  const contributeMutation = useMutation({
    mutationFn: async (pinValue: string) =>
      (await api.post(
        `/tontines/${id}/contribute`,
        { pin: pinValue },
        { headers: { 'Idempotency-Key': crypto.randomUUID() } },
      )).data,
    onSuccess: () => {
      setShowPin(false);
      setPin('');
      setContributeError('');
      queryClient.invalidateQueries({ queryKey: ['tontine', id] });
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
    },
    onError: (err: any) => {
      setContributeError(err.response?.data?.message || 'Le paiement a échoué');
      setPin('');
    },
  });

  if (isLoading || !data) {
    return (
      <div className="p-6 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const { group, members, current_cycle: cycle } = data;
  const isCreator = group.creator_id === currentUserId;
  const myMember = members.find((m: any) => m.user_id === currentUserId);
  const activeCount = members.filter((m: any) => m.status === 'active').length;
  const myContribution = cycle?.contributions?.find((c: any) => c.member?.user_id === currentUserId);
  const canContribute = group.status === 'active' && myContribution && myContribution.status !== 'paid';
  const isMyTurn = cycle?.recipient?.user_id === currentUserId;

  const payoutOrder = group.status !== 'forming'
    ? [...members]
        .filter((m: any) => m.payout_position)
        .sort((a: any, b: any) => a.payout_position - b.payout_position)
    : [];

  return (
    <div className="p-6 pb-28 md:pb-6 space-y-6 max-w-2xl mx-auto">
      <button onClick={() => navigate('/dashboard/tontines')} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Retour
      </button>

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-foreground truncate">{group.name}</h1>
          <p className="text-sm text-muted-foreground">
            {formatCurrency(group.contribution_amount_cents, group.currency)} · {group.frequency === 'weekly' ? 'Hebdomadaire' : 'Mensuelle'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Badge variant={group.status === 'active' ? 'success' : group.status === 'completed' ? 'error' : 'warning'}>
            {STATUS_LABEL[group.status] || group.status}
          </Badge>
          <button
            onClick={() => navigate(`/dashboard/tontines/${id}/settings`)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            aria-label="Réglages"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {myMember?.status === 'invited' && (
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-foreground font-semibold mb-1">Vous êtes invité(e) à rejoindre cette tontine</p>
            <p className="text-sm text-muted-foreground mb-4">
              Cotisation : {formatCurrency(group.contribution_amount_cents, group.currency)} par cycle
            </p>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => respondMutation.mutate(true)} disabled={respondMutation.isPending}>
                Accepter
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => respondMutation.mutate(false)} disabled={respondMutation.isPending}>
                Refuser
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {group.status === 'active' && cycle && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cycle en cours (n°{cycle.cycle_number})</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              Reçoit la cagnotte : <span className="font-semibold text-foreground">{cycle.recipient?.display_name}</span>
              {isMyTurn && ' (vous !)'} · Échéance {formatDate(cycle.due_date)}
            </p>
            {!isMyTurn && (
              <div className="space-y-2 mb-4">
                {cycle.contributions?.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{c.member?.display_name}</span>
                    {c.status === 'paid' ? (
                      <span className="flex items-center gap-1 text-success"><Check className="w-4 h-4" /> Payé</span>
                    ) : (
                      <span className="flex items-center gap-1 text-muted-foreground"><Clock className="w-4 h-4" /> En attente</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {canContribute && !showPin && (
              <>
                <Button className="w-full" onClick={() => setShowPin(true)}>
                  Cotiser {formatCurrency(myContribution.effective_amount_cents ?? myContribution.amount_cents, myContribution.currency)}
                </Button>
                {myContribution.effective_amount_cents > myContribution.amount_cents && (
                  <p className="text-xs text-destructive text-center mt-2">Inclut une pénalité de retard</p>
                )}
              </>
            )}
            {showPin && (
              <div className="text-center">
                {contributeError && <p className="text-sm text-destructive mb-3">{contributeError}</p>}
                <p className="text-sm text-muted-foreground mb-3">Entrez votre code PIN pour cotiser</p>
                <PinInput
                  value={pin}
                  onChange={(v) => {
                    setPin(v);
                    if (v.length === 4) contributeMutation.mutate(v);
                  }}
                  length={4}
                  autoFocus
                />
                {contributeMutation.isPending && <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto mt-3" />}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {payoutOrder.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ordre de passage</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {payoutOrder.map((m: any) => {
                const alreadyReceived = group.status === 'completed' || m.payout_position < group.current_cycle;
                const receivingNow = group.status === 'active' && m.payout_position === group.current_cycle;
                const nextUp = group.status === 'active' && m.payout_position === group.current_cycle + 1;
                return (
                  <div key={m.id} className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-mono text-muted-foreground flex-shrink-0">n°{m.payout_position}</span>
                      <span className="text-foreground truncate">{m.display_name}</span>
                      {m.user_id === currentUserId && <span className="text-xs text-muted-foreground flex-shrink-0">(vous)</span>}
                    </div>
                    {alreadyReceived ? (
                      <Badge variant="success" className="flex-shrink-0">
                        <Check className="w-3 h-3 mr-1" /> A déjà reçu
                      </Badge>
                    ) : receivingNow ? (
                      <Badge className="flex-shrink-0">Reçoit maintenant</Badge>
                    ) : nextUp ? (
                      <Badge variant="warning" className="flex-shrink-0">Prochain tour</Badge>
                    ) : (
                      <Badge variant="secondary" className="flex-shrink-0">En attente</Badge>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex items-start gap-2 mt-4 pt-4 border-t border-border">
              <Info className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                Un nouveau membre qui rejoint après le tirage est toujours ajouté en dernière position — il ne peut jamais passer avant quelqu'un déjà en attente. Il cotise dès son arrivée pour tous les cycles restants, mais ne doit rien pour les cycles déjà terminés.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Membres ({activeCount}/{group.max_members})</CardTitle>
        </CardHeader>
        <CardContent>
          {members.map((m: any) => (
            <div key={m.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <div className="flex items-center gap-2">
                {m.user_id === group.creator_id && <Crown className="w-4 h-4 text-warning" />}
                <span className="text-foreground">{m.display_name}</span>
                {m.user_id === currentUserId && <span className="text-xs text-muted-foreground">(vous)</span>}
                {m.user_id === group.creator_id && (
                  <span className="text-xs font-medium text-warning">Administrateur</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {m.payout_position && <span className="text-xs text-muted-foreground">Tour n°{m.payout_position}</span>}
                <Badge variant={m.status === 'active' ? 'success' : m.status === 'declined' ? 'error' : 'warning'}>
                  {m.status === 'active' ? 'Actif' : m.status === 'invited' ? 'Invité' : 'Refusé'}
                </Badge>
                {isCreator && m.status === 'invited' && (
                  <button
                    onClick={() => cancelInviteMutation.mutate(m.id)}
                    disabled={cancelInviteMutation.isPending}
                    className="text-xs text-muted-foreground hover:text-destructive underline"
                  >
                    Annuler
                  </button>
                )}
              </div>
            </div>
          ))}

          {isCreator && (group.status === 'forming' || group.status === 'active') && (
            <div className="mt-4 space-y-3">
              <div className="space-y-2">
                <Label htmlFor="invite_number" className="font-semibold text-sm">Inviter par numéro ScanLinkPay</Label>
                {inviteError && <p className="text-xs text-destructive">{inviteError}</p>}
                <div className="flex gap-2">
                  <Input
                    id="invite_number"
                    placeholder="SLP-00001234"
                    value={walletNumber}
                    onChange={(e) => setWalletNumber(e.target.value)}
                    className="font-mono"
                  />
                  <Button onClick={() => inviteMutation.mutate()} disabled={!walletNumber || inviteMutation.isPending}>
                    {inviteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                  </Button>
                </div>
                {group.status === 'active' && (
                  <p className="text-xs text-muted-foreground">
                    La tontine est déjà en cours — la personne invitée rejoindra en dernière position et cotisera dès le cycle actuel.
                  </p>
                )}
              </div>
              {group.status === 'forming' && activeCount === group.max_members && (
                <Button className="w-full" onClick={() => drawMutation.mutate()} disabled={drawMutation.isPending}>
                  {drawMutation.isPending ? <Loader2 className="mr-2 w-4 h-4 animate-spin" /> : <Shuffle className="mr-2 w-4 h-4" />}
                  Lancer le tirage au sort
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {data.contribution_history?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Historique des cotisations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.contribution_history.map((c: any) => (
                <div key={c.id} className="flex items-center justify-between py-1.5 text-sm">
                  <div className="min-w-0">
                    <span className="text-foreground font-medium">{c.member?.display_name}</span>
                    <span className="text-muted-foreground"> · cycle n°{c.cycle?.cycle_number}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 text-muted-foreground">
                    <span className="font-semibold text-foreground">{formatCurrency(c.amount_cents, c.currency)}</span>
                    <span>{formatDate(c.paid_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
