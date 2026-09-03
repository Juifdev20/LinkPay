import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { formatDate } from '@/lib/utils';
import { Check, X, Loader2 } from 'lucide-react';

export default function AdminMerchantsPage() {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['admin-merchants'],
    queryFn: async () => {
      const { data } = await api.get('/admin/merchants');
      return data;
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.put(`/admin/merchants/${id}/status`, { status: 'active' });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-merchants'] }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.put(`/admin/merchants/${id}/status`, { status: 'rejected' });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-merchants'] }),
  });

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <PageHeader title="Commerçants" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold">{data?.data?.length || 0} commerçant(s)</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.data?.length ? (
            <div>
              {data.data.map((m: any) => (
                <div key={m.id} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                  <div>
                    <p className="font-semibold text-foreground">{m.name}</p>
                    <p className="text-sm text-muted-foreground">{m.email} - {formatDate(m.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={m.status === 'active' ? 'success' : m.status === 'rejected' ? 'error' : 'warning'}>
                      {m.status}
                    </Badge>
                    {m.status === 'pending' && (
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={approveMutation.isPending}
                          onClick={() => approveMutation.mutate(m.id)}
                        >
                          {approveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 text-success" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={rejectMutation.isPending}
                          onClick={() => rejectMutation.mutate(m.id)}
                        >
                          {rejectMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4 text-destructive" />}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-6">Aucun commerçant</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
