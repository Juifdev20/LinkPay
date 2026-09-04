import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Wallet, Loader2 } from 'lucide-react';

export default function SettlementsPage() {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['settlements'],
    queryFn: async () => {
      const { data } = await api.get('/settlements');
      return data;
    },
  });

  const { data: balance } = useQuery({
    queryKey: ['settlement-balance'],
    queryFn: async () => {
      const { data } = await api.get('/settlements/balance');
      return data;
    },
  });

  const requestMutation = useMutation({
    mutationFn: async () => {
      await api.post('/settlements', {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settlements'] });
      queryClient.invalidateQueries({ queryKey: ['settlement-balance'] });
    },
  });

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <PageHeader title="Règlements" />

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
              <Wallet className="w-5 h-5 text-primary" />
            </div>
            <p className="text-xl font-bold text-foreground">{formatCurrency(balance?.available?.CDF || 0, 'CDF')}</p>
            <p className="text-xl font-bold text-foreground">{formatCurrency(balance?.available?.USD || 0, 'USD')}</p>
            <p className="text-sm text-muted-foreground">Solde disponible</p>
            <Button
              className="w-full mt-4"
              disabled={(!balance?.available?.CDF && !balance?.available?.USD) || requestMutation.isPending}
              onClick={() => requestMutation.mutate()}
            >
              {requestMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
              Demander un règlement
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center mb-3">
              <Wallet className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="text-xl font-bold text-foreground">{formatCurrency(balance?.pending?.CDF || 0, 'CDF')}</p>
            <p className="text-xl font-bold text-foreground">{formatCurrency(balance?.pending?.USD || 0, 'USD')}</p>
            <p className="text-sm text-muted-foreground">En attente</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold">Historique des règlements</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.data?.length ? (
            <div>
              {data.data.map((s: any) => (
                <div key={s.id} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                  <div>
                    <p className="font-semibold text-sm text-foreground">{s.reference}</p>
                    <p className="text-sm text-muted-foreground">{formatDate(s.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-foreground">{formatCurrency(s.net_cents, s.currency)}</span>
                    <Badge variant={s.status === 'COMPLETED' ? 'success' : s.status === 'FAILED' ? 'error' : 'warning'}>
                      {s.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-6">Aucun règlement</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
