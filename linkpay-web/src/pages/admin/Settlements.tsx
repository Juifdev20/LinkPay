import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

const NEXT_STATUS: Record<string, string> = {
  PENDING: 'PROCESSING',
  PROCESSING: 'COMPLETED',
};

const NEXT_LABEL: Record<string, string> = {
  PENDING: 'Marquer en traitement',
  PROCESSING: 'Marquer payé',
};

export default function AdminSettlementsPage() {
  const queryClient = useQueryClient();
  const [failingId, setFailingId] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['admin-settlements'],
    queryFn: async () => {
      const { data } = await api.get('/settlements');
      return data;
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await api.put(`/settlements/${id}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-settlements'] });
      setFailingId(null);
    },
  });

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <PageHeader title="Règlements" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold">{data?.total || 0} règlement(s)</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.data?.length ? (
            <div>
              {data.data.map((s: any) => {
                const isPending = statusMutation.isPending && statusMutation.variables?.id === s.id;
                const nextStatus = NEXT_STATUS[s.status];
                return (
                  <div key={s.id} className="flex items-center justify-between gap-3 py-3 border-b border-border last:border-0">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-foreground truncate">{s.reference}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {s.merchant?.name || s.merchant_id} · {formatDate(s.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="font-bold text-sm text-foreground">{formatCurrency(s.net_cents, s.currency)}</span>
                      <Badge
                        variant={
                          s.status === 'COMPLETED' ? 'success' : s.status === 'FAILED' ? 'error' : 'warning'
                        }
                      >
                        {s.status}
                      </Badge>
                      {nextStatus && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isPending}
                          onClick={() => statusMutation.mutate({ id: s.id, status: nextStatus })}
                        >
                          {isPending && failingId !== s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : NEXT_LABEL[s.status]}
                        </Button>
                      )}
                      {(s.status === 'PENDING' || s.status === 'PROCESSING') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          disabled={isPending}
                          onClick={() => {
                            setFailingId(s.id);
                            statusMutation.mutate({ id: s.id, status: 'FAILED' });
                          }}
                        >
                          {isPending && failingId === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Échec'}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-6">Aucun règlement</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
