import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/PageHeader';
import { formatDate } from '@/lib/utils';
import { Loader2, ShieldAlert } from 'lucide-react';

const FLAG_LABELS: Record<string, string> = {
  OUTFLOW_VELOCITY: 'Trop d’opérations en une heure',
  RECIPIENT_FAN_OUT: 'Envoi à trop de portefeuilles différents',
  NEW_WALLET_LARGE_OUTFLOW: 'Gros montant depuis un portefeuille tout neuf',
  LARGE_OUTFLOW: 'Montant très élevé',
  LARGE_AMOUNT: 'Montant élevé',
  VERY_LARGE_AMOUNT: 'Montant très élevé',
  HIGH_FREQUENCY: 'Fréquence élevée',
  MULTIPLE_FAILED_ATTEMPTS: 'Échecs répétés',
};

const flagInfo = (f: any) => (typeof f === 'string' ? { code: f } : f);

export default function AdminRiskLogsPage() {
  const queryClient = useQueryClient();
  const [showResolved, setShowResolved] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['risk-logs', showResolved],
    queryFn: async () => (await api.get('/risk-logs', { params: { resolved: showResolved } })).data as any[],
    refetchInterval: 30_000,
  });

  const resolve = useMutation({
    mutationFn: async ({ id, resolution }: { id: string; resolution: string }) => {
      await api.post(`/risk-logs/${id}/resolve`, { resolution });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['risk-logs'] }),
  });

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <PageHeader title="Alertes de sécurité" />
      <p className="text-sm text-muted-foreground">
        Opérations bloquées ou signalées automatiquement (retraits et transferts suspects). Vérifiez-les, contactez l'utilisateur si besoin, puis marquez-les comme traitées.
      </p>

      <div className="flex gap-2">
        <Button size="sm" variant={showResolved ? 'outline' : 'default'} onClick={() => setShowResolved(false)}>À traiter</Button>
        <Button size="sm" variant={showResolved ? 'default' : 'outline'} onClick={() => setShowResolved(true)}>Traitées</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold flex items-center gap-2"><ShieldAlert className="w-4 h-4" />{data?.length ?? 0} entrée(s)</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : data?.length ? (
            data.map((log) => {
              const flags = (log.flags || []).map(flagInfo);
              const first = flags[0] || {};
              return (
                <div key={log.id} className="py-3 border-b border-border last:border-0 flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap gap-1.5">
                      {flags.map((f: any, i: number) => (
                        <Badge key={i} variant={f.blocked ? 'destructive' : 'secondary'}>{FLAG_LABELS[f.code] || f.code}</Badge>
                      ))}
                    </div>
                    {first.amount_cents != null && (
                      <p className="text-sm font-semibold text-foreground">
                        {first.kind === 'WITHDRAWAL' ? 'Retrait' : 'Transfert'} de {(first.amount_cents / 100).toLocaleString('fr-FR')} {first.currency}
                        {first.blocked ? ' — bloqué' : ' — à vérifier'}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground break-all">
                      {formatDate(log.created_at)}{first.user_id ? ` · utilisateur ${first.user_id}` : ''}{first.wallet_id ? ` · portefeuille ${first.wallet_id}` : ''}
                    </p>
                    {log.resolution && <p className="text-xs text-muted-foreground">Note : {log.resolution}</p>}
                  </div>
                  {!log.resolved && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={resolve.isPending && resolve.variables?.id === log.id}
                      onClick={() => {
                        const resolution = window.prompt('Note de traitement (ex. « vérifié avec le client »)');
                        if (resolution && resolution.trim().length >= 3) resolve.mutate({ id: log.id, resolution: resolution.trim() });
                      }}
                    >
                      Traité
                    </Button>
                  )}
                </div>
              );
            })
          ) : (
            <p className="text-muted-foreground text-center py-6">Rien à signaler</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
