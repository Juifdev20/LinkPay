import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { UserPlus, Loader2, X } from 'lucide-react';

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

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      <PageHeader title="Équipe" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-primary" />
            Inviter un caissier
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            La personne doit déjà avoir un compte LinkPay (au moins un compte client).
          </p>
          {inviteError && (
            <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium">
              {inviteError}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="invite_email">Email</Label>
            <Input
              id="invite_email"
              type="email"
              placeholder="caissier@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button
            className="w-full"
            disabled={!email || !merchant?.id || inviteMutation.isPending}
            onClick={() => inviteMutation.mutate()}
          >
            {inviteMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
            Inviter
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold">{team?.length || 0} membre(s)</CardTitle>
        </CardHeader>
        <CardContent>
          {team?.length ? (
            <div>
              {team.map((m: any) => (
                <div key={m.id} className="flex items-center justify-between gap-3 py-3 border-b border-border last:border-0">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-foreground truncate">{m.user?.full_name || m.user?.email || 'Utilisateur'}</p>
                    <p className="text-xs text-muted-foreground truncate">{m.user?.email}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge variant="secondary" className="capitalize">{m.role?.slug}</Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={removeMutation.isPending}
                      onClick={() => removeMutation.mutate(m.user_id)}
                    >
                      {removeMutation.isPending && removeMutation.variables === m.user_id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <X className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-6">Aucun membre d'équipe pour l'instant</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
